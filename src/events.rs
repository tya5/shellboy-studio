//! The single `events.wait` long-poll shared by every tab.
//!
//! Owner: the task that runs `run`. Concurrency: exactly one request in flight to the
//! owner at a time (one ordinary owner slot, held for the poll's duration). State: the
//! opaque cursor and the last seen instance, in memory only. Shutdown: the cancellation
//! token; dropping the in-flight call closes its connection. No queue, no buffer.
//!
//! Hints are not data. The loop never reads Thread facts; it tells the hub which Threads
//! changed and lets tabs re-read through the proxy. There is no polling stand-in: when the
//! owner is unreachable the loop only retries `events.wait` with capped exponential backoff.
use crate::{
    envelope::{OwnerEvent, OwnerState},
    hub::{Hub, connected},
    owner::{Owner, instance_of},
    seam,
};
use shellboy::protocol::{ApiError, Command, ErrorCode, EventsWaitStatus};
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy)]
pub struct PollConfig {
    /// Server-side wait per call (the design's 30 s; the owner returns `timeout` after it).
    pub long_poll_ms: u64,
    pub backoff_min: Duration,
    pub backoff_max: Duration,
}

impl Default for PollConfig {
    fn default() -> Self {
        Self {
            long_poll_ms: 30_000,
            backoff_min: Duration::from_millis(250),
            backoff_max: Duration::from_secs(10),
        }
    }
}

pub async fn run<O: Owner>(
    owner: Arc<O>,
    hub: Arc<Hub>,
    config: PollConfig,
    cancel: CancellationToken,
) {
    run_with_guide(owner, hub, config, cancel, None).await;
}

pub async fn run_with_guide<O: Owner>(
    owner: Arc<O>,
    hub: Arc<Hub>,
    config: PollConfig,
    cancel: CancellationToken,
    guide: Option<(std::path::PathBuf, std::path::PathBuf)>,
) {
    let mut cursor: Option<String> = None;
    let mut more = false;
    let mut connected_now = false;
    let mut announced_unreachable = false;
    let mut last_instance: Option<String> = None;
    let mut backoff = config.backoff_min;
    loop {
        let args = seam::events_args(cursor.clone(), if more { 0 } else { config.long_poll_ms });
        let outcome = tokio::select! {
            biased;
            _ = cancel.cancelled() => return,
            outcome = owner.call(Command::EventsWait(args), None, None) => outcome,
        };
        // "Local IPC work capacity is busy": nothing was applied. Routine for a looping client:
        // keep the cursor and the connection state, wait, and poll again (events-and-external-protocol 2.5).
        let refusal = match &outcome {
            Err(error) => Some(error),
            Ok(response) if !response.ok => response.error.as_ref(),
            Ok(_) => None,
        };
        if refusal.is_some_and(is_capacity_busy) {
            tokio::select! {
                _ = cancel.cancelled() => return,
                _ = tokio::time::sleep(backoff) => {}
            }
            backoff = (backoff * 2).min(config.backoff_max);
            continue;
        }
        let decoded = match outcome {
            Ok(response) if response.ok => response
                .result
                .clone()
                .ok_or_else(|| "events.wait reply has no result".to_owned())
                .and_then(seam::decode_events_result)
                .map(|(result, text)| (instance_of(&response), result, text)),
            Ok(response) => Err(response
                .error
                .map(|e| format!("{:?}: {}", e.code, e.message))
                .unwrap_or_else(|| "owner refused events.wait".into())),
            Err(error) => Err(format!("{:?}: {}", error.code, error.message)),
        };
        let (instance, result, text) = match decoded {
            Ok(ok) => ok,
            Err(reason) => {
                if !announced_unreachable {
                    eprintln!("shellboy-studio: owner unreachable: {reason}");
                    hub.set_owner(OwnerState::Unreachable, OwnerEvent::Unreachable);
                    announced_unreachable = true;
                }
                connected_now = false;
                hub.live_clear(); // the owner is gone, and with it the text it held
                cursor = None;
                more = false;
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    _ = tokio::time::sleep(backoff) => {}
                }
                backoff = (backoff * 2).min(config.backoff_max);
                continue;
            }
        };
        backoff = config.backoff_min;
        announced_unreachable = false;
        let restarted = last_instance.is_some() && instance != last_instance;
        let reconnected = !connected_now && last_instance.is_some();
        if !connected_now || restarted {
            #[cfg(feature = "next-shellboy")]
            if let (Some((config_dir, data_dir)), Some(instance_id)) = (&guide, &instance) {
                let registration = crate::guide_preference::register(
                    owner.as_ref(),
                    config_dir,
                    data_dir,
                    instance_id,
                );
                tokio::select! {
                    _ = cancel.cancelled() => return,
                    result = tokio::time::timeout(Duration::from_secs(10), registration) => {
                        match result {
                            Ok(Ok(())) => {},
                            Ok(Err(error)) => eprintln!("shellboy-studio: guide registration: {error}"),
                            Err(_) => eprintln!("shellboy-studio: guide registration timed out"),
                        }
                    }
                }
            }
            #[cfg(not(feature = "next-shellboy"))]
            let _ = &guide;
            let event = if restarted {
                OwnerEvent::Restarted
            } else {
                OwnerEvent::Connected
            };
            hub.set_owner(connected(instance.clone()), event);
            // Anything may have changed while the bridge could not hear the owner.
            if restarted || reconnected {
                hub.resync();
            }
        }
        connected_now = true;
        last_instance = instance;
        cursor = Some(result.cursor);
        more = result.more;
        let reset = matches!(
            result.status,
            EventsWaitStatus::Baseline | EventsWaitStatus::ResyncRequired
        );
        match result.status {
            EventsWaitStatus::Baseline | EventsWaitStatus::Timeout => {}
            // Only text is new; the text itself is applied below.
            #[cfg(feature = "next-shellboy")]
            EventsWaitStatus::Text => {}
            EventsWaitStatus::Changed => {
                hub.hint(result.changes.iter().map(|c| c.thread_id.as_str()));
            }
            EventsWaitStatus::ResyncRequired => hub.resync(),
        }
        if let Some(entries) = text {
            hub.live_apply(entries, reset);
        }
    }
}

/// The owner's refusal when its ordinary slots are full: `invalid_state`, phase `admission`,
/// `request_may_have_been_applied: false` (Shellboy `src/ipc/server.rs`).
fn is_capacity_busy(error: &ApiError) -> bool {
    error.code == ErrorCode::InvalidState
        && error.details.as_ref().is_some_and(|d| {
            d.get("phase").and_then(|v| v.as_str()) == Some("admission")
                && d.get("request_may_have_been_applied")
                    .and_then(|v| v.as_bool())
                    == Some(false)
        })
}
