//! shellboy-web bridge: a thin client of the Shellboy owner's public RPC that serves
//! browsers over HTTP and WebSocket. See `docs/design/architecture.md` and
//! `docs/design/bridge.md`.
//!
//! Layers in this crate: `owner` (the only way to reach the owner), `events` (the single
//! `events.wait` loop), `hub` (bounded fan-out of hints to tabs), `allowlist`, `envelope`
//! (browser frames), `auth`, `server`/`ws` (HTTP and WebSocket) and `seam` (the places
//! that wait for Shellboy protocol 3 and live text deltas).

pub mod allowlist;
pub mod apps;
pub mod assets;
pub mod auth;
pub mod envelope;
pub mod events;
pub mod hub;
pub mod owner;
pub mod process;
pub mod seam;
pub mod server;
pub mod ws_limits {
    pub use crate::ws::{SESSION_IN_FLIGHT, SESSION_QUEUE};
}
mod ws;
