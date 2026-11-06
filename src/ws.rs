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

pub const MAX_CLIENT_FRAME: usize = 1 << 20;
pub const SESSION_IN_FLIGHT: usize = 4;
pub const SESSION_QUEUE: usize = 32;
const RESULT_CHANNEL: usize = SESSION_IN_FLIGHT + SESSION_QUEUE + 4;

/// Decode and authorize one call. Mutations from the web are recorded as human with the
/// label `web` (architecture 4.4).
pub fn build_command(command: &str, args: Option<Value>) -> Result<Command, BridgeError> {
    let value = json!({"command": command, "args": args.unwrap_or_else(|| json!({}))});
    let mut parsed: Command = serde_json::from_value(value)
        .map_err(|e| BridgeError::new("invalid_call", format!("cannot decode call: {e}")))?;
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
        owner: owner_state,
    };
    if !send(&mut socket, &hello).await {
        return;
    }
    let (results_tx, mut results_rx) = mpsc::channel::<ServerFrame>(RESULT_CHANNEL);
    let in_flight = Arc::new(Semaphore::new(SESSION_IN_FLIGHT));
    let outstanding = Arc::new(AtomicUsize::new(0));
    let mut tasks: JoinSet<()> = JoinSet::new();
    let mut handles: HashMap<u64, AbortHandle> = HashMap::new();
    loop {
        tokio::select! {
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
                let (pending, owner) = state.hub.take(&guard);
                if let Some(event) = pending.owner {
                    let frame = ServerFrame::Owner { event, owner };
                    if !send(&mut socket, &frame).await { break }
                }
                if pending.resync && !send(&mut socket, &ServerFrame::Resync).await { break }
                if (!pending.threads.is_empty() || pending.list)
                    && !send(&mut socket, &ServerFrame::Changed {
                        thread_ids: pending.threads.into_iter().collect(),
                        list: pending.list,
                    }).await { break }
            }
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
    // Dropping `tasks` aborts every outstanding call and closes its owner connection.
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
            return Some(error_frame(
                "invalid_frame",
                &format!("cannot decode frame: {e}"),
            ));
        }
    };
    match frame {
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
            let command = match build_command(&command, args) {
                Ok(command) => command,
                Err(e) => return Some(result_error(id, e)),
            };
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
                let frame = match owner.call(command, operation_id, None).await {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calls_are_decoded_strictly_and_checked_against_the_allowlist() {
        assert!(build_command("thread.list", None).is_ok());
        assert_eq!(
            build_command("owner.shutdown", Some(json!({"instance_id":"x"})))
                .unwrap_err()
                .code,
            "not_allowed"
        );
        assert_eq!(
            build_command("events.wait", None).unwrap_err().code,
            "not_allowed"
        );
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
}
