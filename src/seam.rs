//! The two places where the bridge waits for Shellboy work that is not on `main` yet.
//! Everything else in the bridge is written against the adopted protocol 2 contract.
//!
//! 1. Protocol 3 handshake (#244 A2): `Welcome.capabilities`. Today the owner advertises
//!    nothing, so `owner_capabilities` returns an empty list. When A2 lands, this function
//!    (or the call site in `events.rs` that builds `OwnerInfo`) takes the advertised list
//!    from the handshake and the bridge starts gating newer operations on it.
//! 2. Live text deltas (E3): they will travel in the same `events.wait` result. Today the
//!    result is decoded strictly as `EventsWaitResult`, so any new field fails loudly
//!    instead of being guessed. When E3 lands, `decode_events_result` returns the chunks
//!    from the new fields and the hub forwards them as `stream` frames (the browser frame
//!    already exists in `envelope.rs`; nothing produces it yet).
use serde_json::Value;
use shellboy::protocol::EventsWaitResult;

/// Text written since a cursor for one Thread (browser `stream` frame payload).
#[derive(Debug, Clone, PartialEq)]
pub struct StreamChunk {
    pub thread_id: String,
    pub cursor: String,
    pub text: String,
    pub gap: bool,
}

pub fn owner_capabilities() -> Vec<String> {
    // Protocol 2 has no way to ask, so this says what this bridge was built to send.
    let mut capabilities = Vec::new();
    if cfg!(feature = "next-shellboy") {
        capabilities.push("thread.reparent".to_owned());
        capabilities.push("config.edit".to_owned());
        capabilities.push("history.window".to_owned());
    }
    if cfg!(feature = "next-connection-setup") {
        capabilities.push("connection.setup".to_owned());
    }
    capabilities
}

/// Decode one `events.wait` result. The second element is always empty until E3 exists.
pub fn decode_events_result(value: Value) -> Result<(EventsWaitResult, Vec<StreamChunk>), String> {
    serde_json::from_value::<EventsWaitResult>(value)
        .map(|result| (result, Vec::new()))
        .map_err(|error| format!("unexpected events.wait result: {error}"))
}
