//! The two places where the bridge waits for Shellboy work that is not on `main` yet.
//! Everything else in the bridge is written against the adopted protocol 2 contract.
//!
//! 1. Protocol 3 handshake (#244 A2): `Welcome.capabilities`. Today the owner advertises
//!    nothing, so `owner_capabilities` returns an empty list. When A2 lands, this function
//!    (or the call site in `events.rs` that builds `OwnerInfo`) takes the advertised list
//!    from the handshake and the bridge starts gating newer operations on it.
//! 2. Live text (E3, Shellboy #243): on Shellboy main, in no release. `events.wait` takes
//!    `include_text` and returns `live_text`. Both exist only in a build with the Cargo feature
//!    `next-shellboy` (against a Shellboy that has them); a normal build, pinned to v0.10.0,
//!    never asks, never decodes it and advertises no `live.text` capability.
use crate::live::Entry;
use serde_json::Value;
use shellboy::protocol::{EventsWaitArgs, EventsWaitResult};

pub fn owner_capabilities() -> Vec<String> {
    // Protocol 2 has no way to ask, so this says what this bridge was built to send.
    let mut capabilities = Vec::new();
    if cfg!(feature = "next-shellboy") {
        capabilities.push("thread.reparent".to_owned());
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
