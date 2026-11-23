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

#[cfg(any(target_os = "macos", windows))]
pub mod desktop;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
pub mod windows;

/// Only called after resolving a locally registered, regular artifact version.
#[cfg(any(target_os = "macos", windows))]
pub(crate) async fn open_artifact_file(path: &std::path::Path) -> Result<(), String> {
    let path = path
        .to_str()
        .ok_or_else(|| "Invalid artifact path".to_owned())?;
    #[cfg(target_os = "macos")]
    return macos::open_browser(path).await;
    #[cfg(windows)]
    return windows::open_browser(path).await;
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) async fn open_artifact_file(_path: &std::path::Path) -> Result<(), String> {
    Err("Desktop launcher unavailable".into())
}
