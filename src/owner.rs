//! The bridge reaches the owner only through this trait. The real implementation is
//! `shellboy::ipc::call` (endpoint discovery, handshake and peer checks are Shellboy's code).
use serde_json::Value;
use shellboy::{
    ipc,
    protocol::{ApiError, Command, Origin, Response},
};
use std::{future::Future, path::PathBuf};

pub trait Owner: Send + Sync + 'static {
    /// One request on one owner connection. Dropping the future closes the connection,
    /// which cancels a read on the owner side.
    fn call(
        &self,
        command: Command,
        operation_id: Option<String>,
        origin: Option<Origin>,
    ) -> impl Future<Output = Result<Response<Value>, ApiError>> + Send;
}

/// Local IPC owner in a data directory.
pub struct IpcOwner {
    data_dir: PathBuf,
}

impl IpcOwner {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }
}

impl Owner for IpcOwner {
    async fn call(
        &self,
        command: Command,
        operation_id: Option<String>,
        origin: Option<Origin>,
    ) -> Result<Response<Value>, ApiError> {
        ipc::call(&self.data_dir, command, operation_id, origin).await
    }
}

/// The owner instance that produced a response. Shellboy builds generated operation IDs as
/// `<instance_id>:<uuid>` (the same fact `shellboy chat` uses); `None` if the ID has no
/// instance prefix.
pub fn instance_of(response: &Response<Value>) -> Option<String> {
    response
        .operation_id
        .split_once(':')
        .map(|(id, _)| id.to_owned())
        .filter(|id| !id.is_empty())
}
