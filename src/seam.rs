//! Version-pairing seams for the protocol-5 candidate. The committed release pin is
//! deliberately unchanged until the Core tag is public and independently validated.
//! `next-shellboy` is checked against that candidate with an isolated CLI patch;
//! it is not an older-owner compatibility shim. Shell ownership is unchanged.
use crate::live::Entry;
use serde_json::Value;
use shellboy::protocol::{EventsWaitArgs, EventsWaitResult};

pub fn owner_capabilities() -> Vec<String> {
    // Bridge-side operation support; owner handshake capabilities remain authoritative.
    let mut capabilities = Vec::new();
    if cfg!(feature = "next-shellboy") {
        capabilities.push("thread.reparent".to_owned());
        capabilities.push("thread.settings".to_owned());
        capabilities.push("config.edit".to_owned());
        capabilities.push("live.text".to_owned());
        capabilities.push("history.window".to_owned());
    }
    if cfg!(feature = "next-tags") {
        capabilities.push("thread.tags".to_owned());
    }
    if cfg!(feature = "next-cwds") {
        capabilities.push("thread.cwds".to_owned());
    }
    if cfg!(feature = "next-connection-setup") {
        capabilities.push("connection.setup".to_owned());
    }
    capabilities
}

/// The arguments of the shared poll. With live text support it also asks for the text (the
/// loop always starts from a baseline, as the client rule requires).
pub fn events_args(after: Option<String>, timeout_ms: u64) -> EventsWaitArgs {
    EventsWaitArgs {
        after,
        thread_ids: Vec::new(),
        timeout_ms,
        #[cfg(feature = "next-shellboy")]
        include_text: true,
        #[cfg(feature = "next-shellboy")]
        include_reasoning_activity: false,
    }
}

/// Decode one `events.wait` result. The second element is the attempts the owner listed as
/// holding text, or `None` when text was not asked for.
pub fn decode_events_result(
    value: Value,
) -> Result<(EventsWaitResult, Option<Vec<Entry>>), String> {
    let result = serde_json::from_value::<EventsWaitResult>(value)
        .map_err(|error| format!("unexpected events.wait result: {error}"))?;
    let text = live_entries(&result);
    Ok((result, text))
}

#[cfg(feature = "next-shellboy")]
fn live_entries(result: &EventsWaitResult) -> Option<Vec<Entry>> {
    result.live_text.as_ref().map(|list| {
        list.iter()
            .map(|e| Entry {
                thread_id: e.thread_id.clone(),
                attempt_id: e.attempt_id.clone(),
                gap: e.gap,
                deltas: e
                    .deltas
                    .iter()
                    .map(|d| crate::live::Delta {
                        offset: d.offset,
                        reasoning: d.reasoning,
                        text: d.text.clone(),
                    })
                    .collect(),
            })
            .collect()
    })
}

#[cfg(not(feature = "next-shellboy"))]
fn live_entries(_result: &EventsWaitResult) -> Option<Vec<Entry>> {
    None
}
