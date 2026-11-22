//! The bundled launcher's lifecycle; ordinary CLI bridges have no launcher channel.
use tokio::sync::{mpsc, watch};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Restart,
    Exit,
}
#[derive(Clone)]
pub struct Control {
    pub diagnostic: watch::Receiver<Option<String>>,
    pub restart: mpsc::Sender<()>,
    pub marker: String,
}

#[cfg(target_os = "macos")]
pub mod macos;
