//! The bridge reaches the owner only through this trait. The real implementation is
//! `shellboy::ipc::call` (endpoint discovery, handshake and peer checks are Shellboy's code).
use serde_json::Value;
use shellboy::{
    ipc,
    protocol::{ApiError, Command, Origin, Response},
};
use std::{future::Future, path::PathBuf};

pub trait Owner: Send + Sync + 'static {
    fn is_local_ipc(&self) -> bool {
        false
    }

    /// Read stable owner identity and the current operation epoch from Core status.
    fn owner_facts(&self) -> impl Future<Output = Option<(String, String)>> + Send {
        async {
            let response = self
                .call(
                    Command::Status(shellboy::protocol::StatusArgs {
                        limit: 1,
                        ..Default::default()
                    }),
                    None,
                    None,
                )
                .await
                .ok()?;
            let result = response.result?;
            Some((
                result.get("instance_id")?.as_str()?.to_owned(),
                result.get("operation_epoch")?.as_str()?.to_owned(),
            ))
        }
    }

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
    fn is_local_ipc(&self) -> bool {
        true
    }

    async fn call(
        &self,
        command: Command,
        operation_id: Option<String>,
        origin: Option<Origin>,
    ) -> Result<Response<Value>, ApiError> {
        ipc::call(&self.data_dir, command, operation_id, origin).await
    }
}

/// Explicit startup discovery, shared by CLI, bundle startup and manual Restart.
pub async fn startup_probe(owner: &impl Owner) -> Result<(), ApiError> {
    owner
        .call(
            Command::ThreadList(shellboy::protocol::ThreadListArgs {
                limit: 1,
                ..Default::default()
            }),
            None,
            None,
        )
        .await
        .map(|_| ())
}
