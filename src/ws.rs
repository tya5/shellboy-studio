//! One WebSocket session: decode `call`/`watch`/`cancel`, proxy owner calls under bounds,
//! and flush the session's coalesced hints.
//!
//! Bounds per session (limits, not performance claims): `SESSION_IN_FLIGHT` calls running
//! toward the owner, `SESSION_QUEUE` more waiting; beyond that `busy`. Calls are tasks in
//! a `JoinSet` owned by this loop; leaving the loop aborts them, which closes their owner
//! connections. Replies go through a channel of `RESULT_CHANNEL` slots, which can never
//! fill: at most `SESSION_IN_FLIGHT + SESSION_QUEUE` calls can be outstanding.
use crate::{
    allowlist::{Access, access},
    envelope::{BridgeError, ClientFrame, OwnerState, ServerFrame},
    hub::SessionGuard,
    owner::Owner,
    server::AppState,
};
use axum::extract::ws::{Message, WebSocket};
use serde_json::{Value, json};
use shellboy::protocol::Command;
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::{
    sync::{Semaphore, mpsc},
    task::{AbortHandle, JoinSet},
};

/// Up to what an app's `data.write` can carry (8 MiB of text), once escaped. Allocated only when sent.
pub const MAX_CLIENT_FRAME: usize = 24 << 20;
pub const SESSION_IN_FLIGHT: usize = 4;
pub const SESSION_QUEUE: usize = 32;
/// Calls in flight for a tab, counting app calls, which may wait on hints and hold no owner connection.
const APP_CALLS: usize = 256;
const RESULT_CHANNEL: usize = SESSION_IN_FLIGHT + SESSION_QUEUE + APP_CALLS + 4;

/// Decode and authorize one call. Mutations from the web are recorded as human with the
/// label `web` (architecture 4.4).
pub fn build_command(command: &str, args: Option<Value>) -> Result<Command, BridgeError> {
    let args = args.unwrap_or_else(|| json!({}));
    let value = json!({"command": command, "args": args});
    let mut parsed: Command = serde_json::from_value(value)
        .map_err(|_| BridgeError::new("invalid_call", "cannot decode call (command or args)"))?;
    match access(&parsed) {
        Access::Denied => {
            return Err(BridgeError::new(
                "not_allowed",
                format!("{command} is not available through the bridge"),
            ));
        }
        Access::Read | Access::Mutation => {}
    }
    if let Command::MessageSend(send) = &mut parsed {
        send.human = true;
        send.sender_label = Some("web".into());
    }
    Ok(parsed)
}

struct Outstanding(Arc<AtomicUsize>);
impl Drop for Outstanding {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

async fn send(socket: &mut WebSocket, frame: &ServerFrame) -> bool {
    match serde_json::to_string(frame) {
        Ok(text) => socket.send(Message::Text(text.into())).await.is_ok(),
        Err(_) => false,
    }
}

pub async fn session<O: Owner>(
    mut socket: WebSocket,
    state: AppState<O>,
    guard: SessionGuard,
    owner_state: OwnerState,
) {
    let hello = ServerFrame::Hello {
        bridge_version: env!("CARGO_PKG_VERSION"),
        listen: state.config.listen.to_string(),
        data_dir: state.config.data_dir.display().to_string(),
        owner: owner_state,
        desktop: state.launcher.as_ref().map(|_| true),
        core_management: !state.auth.is_disabled(),
    };
    if !send(&mut socket, &hello).await {
        return;
    }
    let mut launcher = state
        .launcher
        .as_ref()
        .map(|control| control.diagnostic.clone());
    if let Some(rx) = &mut launcher {
        let message = rx.borrow_and_update().clone();
        if message.is_some()
            && !send(&mut socket, &ServerFrame::LauncherDiagnostic { message }).await
        {
            return;
        }
    }
    let management = !state.auth.is_disabled();
    let mut lifecycle = state
        .launcher
        .as_ref()
        .filter(|_| management)
        .map(|control| control.state.clone());
    if let Some(rx) = &mut lifecycle {
        let state = rx.borrow_and_update().clone();
        if !send(&mut socket, &ServerFrame::LauncherState { state }).await {
            return;
        }
    }
    let mut stage = state.hub.startup_stage.subscribe();
    let initial_stage = *stage.borrow_and_update();
    if management
        && initial_stage.is_some()
        && !send(
            &mut socket,
            &ServerFrame::StartupStage {
                stage: initial_stage,
            },
        )
        .await
    {
        return;
    }
    let (results_tx, mut results_rx) = mpsc::channel::<ServerFrame>(RESULT_CHANNEL);
    let in_flight = Arc::new(Semaphore::new(SESSION_IN_FLIGHT));
    let outstanding = Arc::new(AtomicUsize::new(0));
    let mut tasks: JoinSet<()> = JoinSet::new();
    let mut handles: HashMap<u64, AbortHandle> = HashMap::new();
    loop {
        tokio::select! {
            _ = state.cancel.cancelled() => break,
            status = async { match &mut launcher {
                Some(rx) => { rx.changed().await.ok()?; Some(rx.borrow_and_update().clone()) },
                None => std::future::pending().await,
            } } => {
                let Some(message) = status else { break };
                if !send(&mut socket, &ServerFrame::LauncherDiagnostic { message }).await { break; }
            }
            update = async { match &mut lifecycle {
                Some(rx) => { rx.changed().await.ok()?; Some(rx.borrow_and_update().clone()) },
                None => std::future::pending().await,
            } } => {
                let Some(state) = update else { break };
                if !send(&mut socket, &ServerFrame::LauncherState { state }).await { break; }
            }
            changed = stage.changed(), if management => {
                if changed.is_err() { break; }
                let stage = *stage.borrow_and_update();
                if !send(&mut socket, &ServerFrame::StartupStage { stage }).await { break; }
            }
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { break };
                let text = match message {
                    Message::Text(text) => text,
                    Message::Close(_) => break,
                    Message::Ping(_) | Message::Pong(_) => continue,
                    Message::Binary(_) => {
                        let frame = error_frame("invalid_frame", "binary frames are not used");
                        if !send(&mut socket, &frame).await { break }
                        continue;
                    }
                };
                let reply = handle_frame(
                    &text, &state, &guard, &in_flight, &outstanding,
                    &results_tx, &mut tasks, &mut handles,
                );
                if let Some(frame) = reply
                    && !send(&mut socket, &frame).await
                {
                    break;
                }
            }
            Some(frame) = results_rx.recv() => {
                if let ServerFrame::Result { id, .. } = &frame { handles.remove(id); }
                if !send(&mut socket, &frame).await { break }
            }
            _ = guard.wake.notified() => {
                let (pending, owner, live) = state.hub.take_delivery(&guard);
                if let Some(event) = pending.owner {
                    let frame = ServerFrame::Owner { event, owner };
                    if !send(&mut socket, &frame).await { break }
                }
                // Replay precedes any result from this tab's ensuing history read.
                if pending.resync && !send(&mut socket, &ServerFrame::Resync).await { break }
                if (!pending.threads.is_empty() || pending.list || pending.config_changed)
                    && !send(&mut socket, &ServerFrame::Changed {
                        thread_ids: pending.threads.into_iter().collect(),
                        list: pending.list,
                        config_changed: pending.config_changed,
                    }).await { break }
                let mut open = true;
                for fact in pending.attempt_ends {
                    open = send(&mut socket, &ServerFrame::AttemptEnd { fact }).await;
                    if !open { break }
                }
                if !open { break }
                for out in live {
                    open = send(&mut socket, &out.into()).await;
                    if !open { break }
                }
                if !open { break }
            }
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
    // Dropping `tasks` aborts every outstanding call and closes its owner connection.
}

impl From<crate::live::Out> for ServerFrame {
    fn from(out: crate::live::Out) -> Self {
        match out {
            crate::live::Out::Text {
                thread_id,
                attempt_id,
                input_through_node_id,
                gap,
                deltas,
            } => ServerFrame::Live {
                thread_id,
                attempt_id,
                input_through_node_id,
                gap,
                deltas,
            },
            crate::live::Out::End { thread_id } => ServerFrame::LiveEnd { thread_id },
        }
    }
}

fn error_frame(code: &'static str, message: &str) -> ServerFrame {
    ServerFrame::Error {
        error: BridgeError::new(code, message),
    }
}

fn result_error(id: u64, error: BridgeError) -> ServerFrame {
    ServerFrame::Result {
        id,
        response: None,
        error: Some(error),
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_frame<O: Owner>(
    text: &str,
    state: &AppState<O>,
    guard: &SessionGuard,
    in_flight: &Arc<Semaphore>,
    outstanding: &Arc<AtomicUsize>,
    results_tx: &mpsc::Sender<ServerFrame>,
    tasks: &mut JoinSet<()>,
    handles: &mut HashMap<u64, AbortHandle>,
) -> Option<ServerFrame> {
    let frame: ClientFrame = match serde_json::from_str(text) {
        Ok(frame) => frame,
        Err(e) => {
            let message = if e.line() == 0 {
                "cannot decode frame".to_owned()
            } else {
                format!(
                    "cannot decode frame at line {}, column {}",
                    e.line(),
                    e.column()
                )
            };
            return Some(error_frame("invalid_frame", &message));
        }
    };
    match frame {
        ClientFrame::Launcher {
            action,
            instance_id,
        } => {
            let Some(control) = &state.launcher else {
                return Some(error_frame(
                    "not_allowed",
                    "launcher control is not available",
                ));
            };
            if state.auth.is_disabled() {
                return Some(error_frame(
                    "not_allowed",
                    "launcher control requires authentication",
                ));
            }
            if matches!(action, crate::launcher::Action::Exit) {
                state.cancel.cancel();
            } else {
                use crate::launcher::{Action, Phase};
                let lifecycle = control.state.borrow();
                let owner = state.hub.owner_state();
                let allowed = match (&owner, action, lifecycle.phase) {
                    (
                        OwnerState::Unreachable,
                        Action::Start | Action::Restart,
                        Phase::Stopped | Phase::Exited | Phase::Failed | Phase::External,
                    ) => instance_id.is_none(),
                    (OwnerState::Unreachable, Action::Stop, Phase::Starting) => {
                        instance_id.is_none()
                    }
                    (
                        OwnerState::Connected { info },
                        Action::Stop | Action::Restart,
                        Phase::Running,
                    ) => {
                        instance_id.is_some()
                            && instance_id == info.instance_id
                            && instance_id == lifecycle.instance_id
                    }
                    _ => false,
                };
                if !allowed {
                    return Some(error_frame(
                        "invalid_state",
                        "Core is not down or is not the Core Studio started",
                    ));
                }
                if control
                    .requests
                    .try_send(crate::launcher::Request {
                        action,
                        instance_id,
                    })
                    .is_err()
                {
                    return Some(error_frame("busy", "launcher action already queued"));
                }
            }
            None
        }
        ClientFrame::Watch { thread_ids, list } => state
            .hub
            .watch(guard, thread_ids, list)
            .err()
            .map(|m| error_frame("invalid_watch", &m)),
        ClientFrame::Cancel { id } => {
            if let Some(handle) = handles.remove(&id) {
                handle.abort();
            }
            None
        }
        ClientFrame::Call {
            id,
            command,
            args,
            operation_id,
        } => {
            if handles.contains_key(&id) {
                return Some(result_error(
                    id,
                    BridgeError::new("invalid_call", "call id already in flight"),
                ));
            }
            // The gateway's own calls: they never reach the owner.
            if command == "bridge.memory" {
                let tx = results_tx.clone();
                let handle = tasks.spawn(async move {
                    let result = crate::process::memory().await;
                    let response = json!({"protocol_version": 0, "operation_id": "gateway", "ok": true, "result": result});
                    let _ = tx.send(ServerFrame::Result { id, response: Some(response), error: None }).await;
                });
                handles.insert(id, handle);
                return None;
            }
            if let Some(name) = command.strip_prefix("apps.") {
                return apps_call(name, id, args, state, results_tx, tasks, handles);
            }
            let command = match build_command(&command, args) {
                Ok(command) => command,
                Err(e) => return Some(result_error(id, e)),
            };
            if let Command::OwnerShutdown(args) = &command {
                let owner = state.hub.owner_state();
                let matches = matches!(owner, OwnerState::Connected { info } if info.instance_id.as_deref() == Some(&*args.instance_id));
                let managed_or_starting = state.launcher.as_ref().is_some_and(|control| {
                    matches!(
                        control.state.borrow().phase,
                        crate::launcher::Phase::Running
                            | crate::launcher::Phase::Starting
                            | crate::launcher::Phase::Stopping
                    )
                });
                if state.auth.is_disabled()
                    || !matches
                    || managed_or_starting
                    || operation_id.is_none()
                {
                    return Some(result_error(
                        id,
                        BridgeError::new(
                            "not_allowed",
                            "shutdown requires an authenticated request for the current external Core",
                        ),
                    ));
                }
            }
            if outstanding.load(Ordering::SeqCst) >= SESSION_IN_FLIGHT + SESSION_QUEUE {
                return Some(result_error(
                    id,
                    BridgeError::new("busy", "too many calls in flight; retry on user action"),
                ));
            }
            outstanding.fetch_add(1, Ordering::SeqCst);
            let slot = Outstanding(outstanding.clone());
            let (owner, global, in_flight, tx) = (
                state.owner.clone(),
                state.global.clone(),
                in_flight.clone(),
                results_tx.clone(),
            );
            let handle = tasks.spawn(async move {
                let _slot = slot;
                let (Ok(_session_permit), Ok(_global_permit)) =
                    (in_flight.acquire().await, global.acquire().await)
                else {
                    return;
                };
                let outcome = if operation_id.is_none() && access(&command) == Access::Mutation {
                    let Ok(permit) = tx.clone().reserve_owned().await else {
                        return;
                    };
                    let mut permit = Some(permit);
                    let mut announce = |operation_id: &str| {
                        if let Some(permit) = permit.take() {
                            permit.send(ServerFrame::OperationId {
                                id,
                                operation_id: operation_id.to_owned(),
                            });
                        }
                    };
                    owner.call_announcing(command, None, &mut announce).await
                } else {
                    owner.call(command, operation_id, None).await
                };
                let frame = match outcome {
                    Ok(response) => ServerFrame::Result {
                        id,
                        response: serde_json::to_value(&response).ok(),
                        error: None,
                    },
                    Err(api) => result_error(
                        id,
                        BridgeError {
                            code: "owner_call_failed",
                            message: api.message.clone(),
                            owner_error: Some(Box::new(api)),
                        },
                    ),
                };
                let _ = tx.send(frame).await;
            });
            handles.insert(id, handle);
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn apps_call<O: Owner>(
    name: &str,
    id: u64,
    args: Option<Value>,
    state: &AppState<O>,
    results_tx: &mpsc::Sender<ServerFrame>,
    tasks: &mut JoinSet<()>,
    handles: &mut HashMap<u64, AbortHandle>,
) -> Option<ServerFrame> {
    let apps = state.apps.clone();
    if handles.len() >= APP_CALLS {
        return Some(result_error(
            id,
            BridgeError::new("busy", "too many calls in flight"),
        ));
    }
    let (name, tx) = (name.to_owned(), results_tx.clone());
    let handle = tasks.spawn(async move {
        let text = |key: &str| args.as_ref().and_then(|a| a.get(key)).and_then(Value::as_str).unwrap_or_default().to_owned();
        let result = match name.as_str() {
            "list" => {
                let cursor = args.as_ref().and_then(|a| a.get("cursor")).and_then(Value::as_str);
                apps.list(&text("thread"), cursor).await
            }
            "open" => apps.open(&text("name")).await,
            "instances" => apps.instances(&text("name")).await.map(|items| json!({"items": items})),
            "instance.create" => apps.add_instance(&text("name"), &text("instance")).await,
            "call" => {
                let inner = args.as_ref().and_then(|a| a.get("args")).cloned().unwrap_or_else(|| json!({}));
                Ok(apps.call_instance(&text("name"), &text("op"), inner, args.as_ref().and_then(|a| a.get("instance")).and_then(Value::as_str)).await)
            }
            _ => Err(("invalid_call", format!("no call apps.{name}"))),
        };
        let response = match result {
            Ok(result) => json!({"protocol_version": 0, "operation_id": "gateway", "ok": true, "result": result}),
            Err((code, message)) => json!({"protocol_version": 0, "operation_id": "gateway", "ok": false, "error": {"code": code, "message": message}}),
        };
        let _ = tx.send(ServerFrame::Result { id, response: Some(response), error: None }).await;
    });
    handles.insert(id, handle);
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decode_error_never_repeats_a_credential() {
        for command in ["credentials.set", "connection.test"] {
            let error = build_command(
                command,
                Some(json!({"connection": 7, "value": "SECRET-KEY", "api_key": "SECRET-KEY"})),
            )
            .unwrap_err();
            assert_eq!(error.code, "invalid_call", "{command}");
            assert!(
                !error.message.contains("SECRET-KEY"),
                "{command}: {}",
                error.message
            );
        }
    }

    #[test]
    fn calls_are_decoded_strictly_and_checked_against_the_allowlist() {
        assert!(build_command("thread.list", None).is_ok());
        assert!(build_command("turn.interrupt", Some(json!({"turn_id":"turn"}))).is_ok());
        assert!(build_command("owner.shutdown", Some(json!({"instance_id":"x"}))).is_ok());
        assert_eq!(
            build_command("events.wait", None).unwrap_err().code,
            "not_allowed"
        );
        for (command, args) in [
            (
                "shell.write",
                json!({"execution_id":"shell","text":"input","encoding":"UTF-8"}),
            ),
            ("shell.eof", json!({"execution_id":"shell"})),
        ] {
            assert_eq!(
                build_command(command, Some(args)).unwrap_err().code,
                "not_allowed",
                "{command}"
            );
        }
        for deliver in ["now", "complete"] {
            assert_eq!(
                build_command(
                    "message.send",
                    Some(json!({"thread_id":"t","text":"hi","deliver":deliver}))
                )
                .unwrap_err()
                .code,
                "not_allowed",
                "delivery mode {deliver}"
            );
        }
        assert_eq!(
            build_command("no.such", None).unwrap_err().code,
            "invalid_call"
        );
        assert_eq!(
            build_command("thread.list", Some(json!({"bogus":1})))
                .unwrap_err()
                .code,
            "invalid_call"
        );
        let Command::MessageSend(send) =
            build_command("message.send", Some(json!({"text":"hi","thread_id":"t"}))).unwrap()
        else {
            panic!("message.send")
        };
        assert!(send.human);
        assert_eq!(send.sender_label.as_deref(), Some("web"));
    }

    #[test]
    fn attachment_list_requires_the_paged_pin_and_thread_scope() {
        let scoped = build_command(
            "attachment.list",
            Some(json!({"thread_id":"thread", "limit":50, "cursor":"opaque"})),
        );
        let parsed = scoped.unwrap();
        assert_eq!(access(&parsed), Access::Read);
        let Command::AttachmentList(args) = parsed else {
            panic!("expected attachment.list");
        };
        assert_eq!(args.limit, 50);
        assert_eq!(args.cursor.as_deref(), Some("opaque"));
        assert!(
            build_command(
                "attachment.list",
                Some(json!({"thread_id":"thread","limit":201}))
            )
            .is_err()
        );
        assert!(build_command("attachment.list", Some(json!({"limit":50}))).is_err());
    }

    #[test]
    fn analytics_and_settings_reads_are_allowed_and_their_mutations_are_not() {
        for (command, args) in [
            (
                "usage.get",
                json!({"group_by":"day","timezone":"+09:00","since":"2026-11-01T00:00:00+09:00","limit":168}),
            ),
            ("compact.list", json!({"thread_id":"t","limit":50})),
            ("storage.status", json!({})),
            ("index.status", json!({})),
            ("status", json!({"memory":true})),
            ("model.list", json!({})),
        ] {
            let parsed = build_command(command, Some(args)).unwrap();
            assert_eq!(access(&parsed), Access::Read, "{command}");
        }
        // Nothing here has a preview in the pinned owner, or it stays on its Thread.
        for (command, args) in [
            ("storage.collect", json!({"category":"raw"})),
            ("index.probe", json!({})),
            ("index.rebuild", json!({})),
            ("index.backfill", json!({})),
            (
                "thread.prune",
                json!({"thread_id":"t","before_node_id":"n"}),
            ),
            (
                "thread.set",
                json!({"thread_id":"t","model":"m","title":"bad"}),
            ),
            ("compact", json!({"thread_id":"t"})),
        ] {
            assert_eq!(
                build_command(command, Some(args)).unwrap_err().code,
                "not_allowed",
                "{command}"
            );
        }
    }

    #[cfg(feature = "next-shellboy")]
    #[test]
    fn thread_model_changes_allow_only_selected_fields() {
        for args in [
            json!({"thread_id":"t","model":"m"}),
            json!({"thread_id":"t","cwd":"/tmp"}),
            json!({"thread_id":"t","max_tokens":"1000"}),
            json!({"thread_id":"t","auto_compact_target_percent":"25"}),
            json!({"thread_id":"t","summary_max_chars":"500"}),
            json!({"thread_id":"t","spill":"off"}),
            json!({"thread_id":"t","connection":"c","effort":""}),
            json!({"thread_id":"t","auto_compact_at":"0","agents":"/tmp/AGENTS.md"}),
        ] {
            assert_eq!(
                access(&build_command("thread.set", Some(args)).unwrap()),
                Access::Mutation
            );
        }
        for args in [
            json!({"model":"m"}),
            json!({"thread_id":"t","model":"m","cwd":"/tmp"}),
            json!({"thread_id":"t","cwd":"/tmp","spill":"on"}),
            json!({"thread_id":"t","cwd":"/tmp","title":"x"}),
            json!({"thread_id":"t","agents":"/tmp/AGENTS.md","title":"bad"}),
            json!({"thread_id":"t","model":"m","parent_thread_id":"p"}),
        ] {
            assert_eq!(
                build_command("thread.set", Some(args)).unwrap_err().code,
                "not_allowed"
            );
        }
        // Core v0.12.0 removed these per-Thread settings; the call is rejected, not forwarded.
        for args in [
            json!({"thread_id":"t","segment_chars":"4096"}),
            json!({"thread_id":"t","model":"m","reduce_rounds":"2"}),
        ] {
            assert_eq!(
                build_command("thread.set", Some(args)).unwrap_err().code,
                "invalid_call"
            );
        }
    }

    #[test]
    fn data_layer_mutations_are_allowed() {
        assert!(build_command("run.retry", Some(json!({"run_id":"r"}))).is_ok());
        assert!(
            build_command(
                "thread.archive",
                Some(json!({"thread_ids":["a"],"descendants":true}))
            )
            .is_ok()
        );
        assert!(build_command("thread.list", Some(json!({"archived":"only"}))).is_ok());
        assert!(build_command("thread.unarchive", Some(json!({"thread_ids":["a"]}))).is_ok());
        assert!(build_command("thread.fork", Some(json!({"thread_id":"t","node_id":"n"}))).is_ok());
        assert!(
            build_command(
                "thread.rewind",
                Some(json!({"thread_id":"t","node_id":"n","dry_run":true}))
            )
            .is_ok()
        );
        assert_eq!(
            access(
                &build_command(
                    "thread.branches",
                    Some(json!({"thread_id":"t","limit":200}))
                )
                .unwrap()
            ),
            Access::Read
        );
        assert_eq!(
            access(
                &build_command(
                    "thread.delete_preview",
                    Some(json!({"thread_id":"t","descendants":false}))
                )
                .unwrap()
            ),
            Access::Read
        );
        assert_eq!(access(&build_command("thread.delete", Some(json!({"thread_id":"t","descendants":false,"preview_marker":{"thread_count":1,"ids_hash":"0".repeat(64)}}))).unwrap()), Access::Mutation);
        for (command, args) in [
            (
                "thread.delete",
                json!({"thread_id":"t","descendants":true,"preview_marker":{"thread_count":1,"ids_hash":"0".repeat(64)}}),
            ),
            (
                "thread.delete",
                json!({"thread_id":"t","descendants":false}),
            ),
            (
                "thread.delete_preview",
                json!({"thread_id":"t","descendants":false,"preview_marker":{"thread_count":1,"ids_hash":"0".repeat(64)}}),
            ),
            (
                "thread.delete_preview",
                json!({"thread_id":"","descendants":false}),
            ),
        ] {
            let denied = match build_command(command, Some(args)) {
                Err(e) => e.code == "not_allowed" || e.code == "invalid_call",
                Ok(value) => access(&value) == Access::Denied,
            };
            assert!(denied, "{command}");
        }
    }

    #[test]
    fn exact_delete_set_authorizes_preview_and_guarded_commit_only() {
        let ids = json!(["a", "b"]);
        let preview = build_command(
            "thread.delete_set_preview",
            Some(json!({"thread_ids": ids})),
        )
        .unwrap();
        assert_eq!(access(&preview), Access::Read);
        let marker = json!({"thread_count": 2, "ids_hash": "a".repeat(64)});
        let commit = build_command(
            "thread.delete_set",
            Some(json!({"thread_ids": ids, "preview_marker": marker})),
        )
        .unwrap();
        assert_eq!(access(&commit), Access::Mutation);
        assert!(build_command("thread.delete_set", Some(json!({"thread_ids": ids}))).is_err());
        assert!(
            build_command(
                "thread.delete_set",
                Some(json!({"thread_ids": ["a"], "preview_marker": marker}))
            )
            .is_err()
        );
    }

    #[cfg(feature = "next-tags")]
    #[test]
    fn tag_calls_and_list_filters_are_allowed_with_the_feature() {
        let tag =
            build_command("thread.tag", Some(json!({"thread_ids":["a"],"add":["x"]}))).unwrap();
        assert_eq!(access(&tag), Access::Mutation);
        let tags = build_command("thread.tags", Some(json!({"limit":200}))).unwrap();
        assert_eq!(access(&tags), Access::Read);
        let list = build_command(
            "thread.list",
            Some(json!({"tags":["x"],"cwd":"/w","limit":100})),
        )
        .unwrap();
        assert_eq!(access(&list), Access::Read);
    }
}
