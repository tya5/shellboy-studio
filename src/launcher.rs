//! The bundled launcher's lifecycle; ordinary CLI bridges have no launcher channel.
use serde::Serialize;
use tokio::sync::{mpsc, watch};

#[derive(Clone, Debug, Serialize)]
pub struct Status {
    pub reason: Option<String>,
    pub can_restart: bool,
}
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Restart,
    Exit,
}
#[derive(Clone)]
pub struct Control {
    pub status: watch::Receiver<Status>,
    pub actions: mpsc::Sender<Action>,
    pub marker: String,
}

#[cfg(target_os = "macos")]
pub mod macos;
