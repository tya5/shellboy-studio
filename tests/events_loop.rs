//! The shared `events.wait` loop against a scripted owner (no real owner, no network).
mod common;
use common::*;
use serde_json::json;
use shellboy_studio::{
    envelope::{OwnerEvent, OwnerState},
    events,
    hub::Hub,
};
use std::collections::BTreeSet;
use tokio_util::sync::CancellationToken;

fn start_loop(owner: std::sync::Arc<MockOwner>, hub: std::sync::Arc<Hub>) -> CancellationToken {
    let cancel = CancellationToken::new();
    tokio::spawn(events::run(owner, hub, fast_poll(), cancel.clone()));
    cancel
}

#[tokio::test]
async fn keeps_the_cursor_drains_more_with_zero_timeout_and_fans_out_hints() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let (tab, _) = hub.register().unwrap();
    hub.watch(&tab, vec!["t1".into()], true).unwrap();
    let cancel = start_loop(owner.clone(), hub.clone());

    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    tx.send(events("inst1", "changed", "c2", &["t1", "t9"], true))
        .unwrap();
    tx.send(events("inst1", "timeout", "c3", &[], false))
        .unwrap();
    until("4 polls", || owner.event_args.lock().unwrap().len() == 4).await;

    let args = owner.event_args.lock().unwrap().clone();
    assert_eq!(args[0].after, None);
    assert_eq!(args[0].timeout_ms, 30_000);
    assert!(
        args.iter().all(|a| a.thread_ids.is_empty()),
        "empty filter = all Threads"
    );
    assert_eq!(args[1].after.as_deref(), Some("c1"));
    assert_eq!(args[2].after.as_deref(), Some("c2"));
    assert_eq!(args[2].timeout_ms, 0, "more=true is drained at once");
    assert_eq!(
        args[3].after.as_deref(),
        Some("c3"),
        "cursor survives a timeout"
    );
    assert_eq!(args[3].timeout_ms, 30_000);

    let (pending, owner_state) = hub.take(&tab);
    assert_eq!(
        pending.threads,
        BTreeSet::from(["t1".to_owned()]),
        "only the watched Thread is marked"
    );
    assert!(
        pending.list,
        "a tab showing the list is told about any change"
    );
    assert!(!pending.resync);
    assert!(matches!(owner_state, OwnerState::Connected { .. }));
    cancel.cancel();
}

#[tokio::test]
async fn resync_required_resyncs_every_tab_and_continues_with_the_new_cursor() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let (a, _) = hub.register().unwrap();
    let (b, _) = hub.register().unwrap();
    hub.watch(&a, vec!["t1".into()], false).unwrap();
    let cancel = start_loop(owner.clone(), hub.clone());
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    tx.send(events("inst1", "resync_required", "c9", &[], false))
        .unwrap();
    until("3 polls", || owner.event_args.lock().unwrap().len() == 3).await;
    assert_eq!(
        owner.event_args.lock().unwrap()[2].after.as_deref(),
        Some("c9")
    );
    assert!(hub.take(&a).0.resync);
    assert!(hub.take(&b).0.resync);
    cancel.cancel();
}

#[tokio::test]
async fn unreachable_owner_backs_off_restarts_from_baseline_and_resyncs() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let (tab, _) = hub.register().unwrap();
    let cancel = start_loop(owner.clone(), hub.clone());
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    tx.send(unreachable_owner()).unwrap();
    tx.send(unreachable_owner()).unwrap();
    // Same instance comes back (owner was only briefly unreachable).
    tx.send(events("inst1", "baseline", "c2", &[], false))
        .unwrap();
    until("5 polls", || owner.event_args.lock().unwrap().len() == 5).await;
    let args = owner.event_args.lock().unwrap().clone();
    assert_eq!(
        args[2].after, None,
        "after an error the loop starts again without a cursor"
    );
    assert_eq!(args[3].after, None);
    assert_eq!(args[4].after.as_deref(), Some("c2"));
    let (pending, state) = hub.take(&tab);
    assert_eq!(
        pending.owner,
        Some(OwnerEvent::Connected),
        "latest owner event wins"
    );
    assert!(
        pending.resync,
        "changes may have been missed while unreachable"
    );
    assert!(matches!(state, OwnerState::Connected { .. }));
    cancel.cancel();
}

#[tokio::test]
async fn a_new_owner_instance_is_reported_as_restarted() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let (tab, _) = hub.register().unwrap();
    let cancel = start_loop(owner.clone(), hub.clone());
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    until("first poll answered", || {
        owner.event_args.lock().unwrap().len() == 2
    })
    .await;
    let _ = hub.take(&tab);
    tx.send(unreachable_owner()).unwrap();
    until("unreachable seen", || {
        matches!(hub.owner_state(), OwnerState::Unreachable)
    })
    .await;
    tx.send(events("inst2", "baseline", "d1", &[], false))
        .unwrap();
    until("reconnected", || {
        matches!(hub.owner_state(), OwnerState::Connected { .. })
    })
    .await;
    let (pending, state) = hub.take(&tab);
    assert_eq!(pending.owner, Some(OwnerEvent::Restarted));
    assert!(pending.resync);
    let OwnerState::Connected { info } = state else {
        panic!("connected")
    };
    assert_eq!(info.instance_id.as_deref(), Some("inst2"));
    assert_eq!(
        info.capabilities.iter().any(|c| c == "live.text"),
        cfg!(feature = "next-shellboy"),
        "live text is advertised only by a build that asks for it"
    );
    if !cfg!(feature = "next-shellboy") {
        assert!(
            info.capabilities.is_empty(),
            "protocol 2 owners advertise nothing"
        );
    }
    cancel.cancel();
}

#[tokio::test]
async fn only_one_poll_is_ever_in_flight() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let _sessions: Vec<_> = (0..10).map(|_| hub.register().unwrap().0).collect();
    let cancel = start_loop(owner.clone(), hub);
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    until("second poll", || {
        owner.event_args.lock().unwrap().len() == 2
    })
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert_eq!(
        owner.event_args.lock().unwrap().len(),
        2,
        "the second poll waits for the owner"
    );
    cancel.cancel();
}

#[tokio::test]
async fn work_capacity_busy_is_a_routine_retry_with_the_same_cursor() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let (tab, _) = hub.register().unwrap();
    let cancel = start_loop(owner.clone(), hub.clone());
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    let busy = || {
        Err(shellboy::protocol::ApiError::new(
            shellboy::protocol::ErrorCode::InvalidState,
            "Local IPC work capacity is busy; this request was not accepted",
        )
        .details(json!({"phase":"admission","request_may_have_been_applied":false})))
    };
    tx.send(busy()).unwrap();
    tx.send(busy()).unwrap();
    tx.send(events("inst1", "timeout", "c2", &[], false))
        .unwrap();
    until("5 polls", || owner.event_args.lock().unwrap().len() == 5).await;
    let args = owner.event_args.lock().unwrap().clone();
    assert_eq!(args[1].after.as_deref(), Some("c1"));
    assert_eq!(
        args[2].after.as_deref(),
        Some("c1"),
        "same cursor after busy"
    );
    assert_eq!(args[3].after.as_deref(), Some("c1"));
    assert_eq!(args[4].after.as_deref(), Some("c2"));
    let (pending, state) = hub.take(&tab);
    assert_eq!(
        pending.owner,
        Some(OwnerEvent::Connected),
        "never reported as unreachable"
    );
    assert!(!pending.resync);
    assert!(matches!(state, OwnerState::Connected { .. }));
    cancel.cancel();
}

#[tokio::test]
async fn other_invalid_state_errors_are_still_an_unreachable_owner() {
    let (owner, tx) = mock(|_| None);
    let hub = Hub::new();
    let (tab, _) = hub.register().unwrap();
    let cancel = start_loop(owner.clone(), hub.clone());
    tx.send(events("inst1", "baseline", "c1", &[], false))
        .unwrap();
    tx.send(Err(shellboy::protocol::ApiError::new(
        shellboy::protocol::ErrorCode::InvalidState,
        "something else",
    )))
    .unwrap();
    until("unreachable", || {
        matches!(hub.owner_state(), OwnerState::Unreachable)
    })
    .await;
    let _ = hub.take(&tab);
    cancel.cancel();
}

/// Live text, against a scripted owner. These need a Shellboy that has `include_text`.
#[cfg(feature = "next-shellboy")]
mod live_text {
    use super::*;
    use serde_json::Value;
    use shellboy_studio::live::Out;

    fn text(status: &str, cursor: &str, live: Value, more: bool) -> Reply {
        ok(
            "inst1",
            json!({"status": status, "cursor": cursor, "changes": [], "more": more, "live_text": live}),
        )
    }
    fn entry(thread: &str, attempt: &str, gap: bool, deltas: Value) -> Value {
        json!({"thread_id": thread, "attempt_id": attempt, "gap": gap, "deltas": deltas})
    }
    fn delta(offset: u64, text: &str) -> Value {
        json!({"offset": offset, "reasoning": false, "text": text})
    }
    fn texts(out: Vec<Out>) -> Vec<(String, bool, String)> {
        out.into_iter()
            .map(|o| match o {
                Out::Text {
                    attempt_id,
                    gap,
                    deltas,
                    ..
                } => (
                    attempt_id,
                    gap,
                    deltas.iter().map(|d| d.text.as_str()).collect::<String>(),
                ),
                Out::End { thread_id } => (format!("end:{thread_id}"), false, String::new()),
            })
            .collect()
    }

    #[tokio::test]
    async fn the_poll_asks_for_text_from_a_baseline_and_forwards_baseline_deltas_and_gap() {
        let (owner, tx) = mock(|_| None);
        let hub = Hub::new();
        let (tab, _) = hub.register().unwrap();
        hub.watch(&tab, vec!["t1".into()], false).unwrap();
        let cancel = start_loop(owner.clone(), hub.clone());
        // A baseline mid-attempt carries the retained tail.
        tx.send(text(
            "baseline",
            "c1",
            json!([entry("t1", "a1", false, json!([delta(5, "tail")]))]),
            false,
        ))
        .unwrap();
        tx.send(text(
            "text",
            "c2",
            json!([entry("t1", "a1", false, json!([delta(9, " more")]))]),
            false,
        ))
        .unwrap();
        until("3 polls", || owner.event_args.lock().unwrap().len() == 3).await;
        let args = owner.event_args.lock().unwrap().clone();
        assert!(
            args.iter().all(|a| a.include_text),
            "every poll asks for text"
        );
        assert_eq!(args[0].after, None, "text starts with a baseline");
        let frames = texts(hub.take_live(&tab));
        assert_eq!(frames, vec![("a1".into(), false, "tail more".into())]);
        // A gap: the tab must discard first.
        tx.send(text(
            "text",
            "c3",
            json!([entry("t1", "a1", true, json!([delta(40, "after")]))]),
            false,
        ))
        .unwrap();
        until("4 polls", || owner.event_args.lock().unwrap().len() == 4).await;
        assert_eq!(
            texts(hub.take_live(&tab)),
            vec![("a1".into(), true, "after".into())]
        );
        // A timeout lists the attempt with no deltas: nothing to send.
        tx.send(text(
            "timeout",
            "c4",
            json!([entry("t1", "a1", false, json!([]))]),
            false,
        ))
        .unwrap();
        until("5 polls", || owner.event_args.lock().unwrap().len() == 5).await;
        assert!(hub.take_live(&tab).is_empty());
        // Absent from live_text: no text is held (ended, or past the cap).
        tx.send(text("timeout", "c5", json!([]), false)).unwrap();
        until("6 polls", || owner.event_args.lock().unwrap().len() == 6).await;
        assert_eq!(
            texts(hub.take_live(&tab)),
            vec![("end:t1".into(), false, String::new())]
        );
        cancel.cancel();
    }

    #[tokio::test]
    async fn busy_keeps_the_text_and_the_cursor_and_an_owner_loss_drops_the_text() {
        let (owner, tx) = mock(|_| None);
        let hub = Hub::new();
        let (tab, _) = hub.register().unwrap();
        hub.watch(&tab, vec!["t1".into()], false).unwrap();
        let cancel = start_loop(owner.clone(), hub.clone());
        tx.send(text(
            "baseline",
            "c1",
            json!([entry("t1", "a1", false, json!([delta(0, "hi")]))]),
            false,
        ))
        .unwrap();
        tx.send(Err(shellboy::protocol::ApiError::new(
            shellboy::protocol::ErrorCode::InvalidState,
            "Local IPC work capacity is busy; this request was not accepted",
        )
        .details(
            json!({"phase":"admission","request_may_have_been_applied":false}),
        )))
        .unwrap();
        tx.send(text(
            "text",
            "c2",
            json!([entry("t1", "a1", false, json!([delta(2, "!")]))]),
            false,
        ))
        .unwrap();
        until("4 polls", || owner.event_args.lock().unwrap().len() == 4).await;
        assert_eq!(
            owner.event_args.lock().unwrap()[2].after.as_deref(),
            Some("c1")
        );
        assert_eq!(
            texts(hub.take_live(&tab)),
            vec![("a1".into(), false, "hi!".into())]
        );
        tx.send(unreachable_owner()).unwrap();
        until("unreachable", || {
            matches!(hub.owner_state(), OwnerState::Unreachable)
        })
        .await;
        tx.send(text("baseline", "d1", json!([]), false)).unwrap();
        until("reconnected", || {
            matches!(hub.owner_state(), OwnerState::Connected { .. })
        })
        .await;
        assert!(
            texts(hub.take_live(&tab)).is_empty(),
            "nothing was held across the loss"
        );
        cancel.cancel();
    }
}

// Guide reconciliation precedes Connected. Exercise that startup dependency
// separately from hint fixtures, whose ConfigGet must always be answered.
#[cfg(feature = "next-shellboy")]
mod guide_startup {
    use super::*;
    use shellboy::protocol::Command;
    use shellboy::protocol::{ApiError, ErrorCode, Origin};
    use shellboy_studio::owner::Owner;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::sync::Semaphore;

    struct ConfigGate {
        inner: Arc<MockOwner>,
        entered: AtomicUsize,
        release: Semaphore,
        fail: bool,
    }
    impl Owner for ConfigGate {
        async fn call(
            &self,
            command: Command,
            operation_id: Option<String>,
            origin: Option<Origin>,
        ) -> Reply {
            if matches!(command, Command::ConfigGet(_)) {
                self.entered.fetch_add(1, Ordering::SeqCst);
                self.release.acquire().await.unwrap().forget();
                return if self.fail {
                    Err(ApiError::new(
                        ErrorCode::InvalidState,
                        "synthetic unavailable config",
                    ))
                } else {
                    ok("instance", json!({}))
                };
            }
            self.inner.call(command, operation_id, origin).await
        }
    }

    async fn startup(disabled: bool, fail: bool) {
        let (inner, tx) = mock(|_| None);
        let state = app_state(inner.clone(), false, "127.0.0.1:0".parse().unwrap());
        if disabled {
            shellboy_studio::guide_preference::set_enabled(&state.config.config_dir, false)
                .unwrap();
        }
        let owner = Arc::new(ConfigGate {
            inner: inner.clone(),
            entered: AtomicUsize::new(0),
            release: Semaphore::new(0),
            fail,
        });
        let hub = Hub::new();
        let (tab, _) = hub.register().unwrap();
        hub.watch(&tab, vec!["t1".into()], true).unwrap();
        let cancel = CancellationToken::new();
        let task = tokio::spawn(events::run_with_guide(
            owner.clone(),
            hub.clone(),
            fast_poll(),
            cancel.clone(),
            Some((
                state.config.config_dir.clone(),
                state.config.data_dir.clone(),
            )),
        ));
        tx.send(events("instance", "baseline", "c1", &[], false))
            .unwrap();
        tx.send(events("instance", "changed", "c2", &["t1"], false))
            .unwrap();
        if !disabled {
            until("registration entered", || {
                owner.entered.load(Ordering::SeqCst) == 1
            })
            .await;
            assert_eq!(
                inner.event_args.lock().unwrap().len(),
                1,
                "ConfigGet blocks the next poll, not cursor decoding"
            );
            assert!(!matches!(hub.take(&tab).1, OwnerState::Connected { .. }));
            owner.release.add_permits(1);
        }
        until("changed consumed", || {
            inner.event_args.lock().unwrap().len() == 3
        })
        .await;
        assert_eq!(owner.entered.load(Ordering::SeqCst), usize::from(!disabled));
        assert_eq!(
            inner.event_args.lock().unwrap()[1].after.as_deref(),
            Some("c1")
        );
        let (pending, owner_state) = hub.take(&tab);
        assert!(matches!(owner_state, OwnerState::Connected { .. }));
        assert!(pending.threads.contains("t1"));
        cancel.cancel();
        task.await.unwrap();
        if disabled {
            std::fs::remove_dir_all(state.config.config_dir.parent().unwrap()).unwrap();
        }
    }

    #[tokio::test]
    async fn slow_guide_config_delays_connected_until_released_without_losing_cursor() {
        startup(false, false).await;
    }
    #[tokio::test]
    async fn guide_error_does_not_prevent_connected_or_hints() {
        startup(false, true).await;
    }
    #[tokio::test]
    async fn guide_disabled_never_reads_owner_config() {
        startup(true, false).await;
    }
}
