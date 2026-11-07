//! The shared `events.wait` loop against a scripted owner (no real owner, no network).
mod common;
use common::*;
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
    assert!(
        info.capabilities.is_empty(),
        "protocol 2 owners advertise nothing"
    );
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
