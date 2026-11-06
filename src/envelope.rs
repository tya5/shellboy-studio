//! Browser frames (`/ws`, JSON text). Owner payloads pass through unchanged.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use shellboy::protocol::ApiError;

/// Frames a tab may send. Unknown `t` or fields are rejected.
#[derive(Debug, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientFrame {
    /// Proxy one owner RPC.
    Call {
        id: u64,
        command: String,
        #[serde(default)]
        args: Option<Value>,
        #[serde(default)]
        operation_id: Option<String>,
    },
    /// Replace this tab's subscription.
    Watch {
        #[serde(default)]
        thread_ids: Vec<String>,
        #[serde(default)]
        list: bool,
    },
    /// Drop a pending call.
    Cancel { id: u64 },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OwnerInfo {
    pub protocol_version: u32,
    pub instance_id: Option<String>,
    pub capabilities: Vec<String>,
}

/// `unreachable` is the absence of info.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum OwnerState {
    Connected { info: OwnerInfo },
    Unreachable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerEvent {
    Connected,
    Unreachable,
    Restarted,
}

/// A failure of the bridge itself (not an owner reply).
#[derive(Debug, Serialize)]
pub struct BridgeError {
    pub code: &'static str,
    pub message: String,
    /// The owner's own error when the failure came from the owner call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_error: Option<Box<ApiError>>,
}

impl BridgeError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            owner_error: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ServerFrame {
    Hello {
        bridge_version: &'static str,
        owner: OwnerState,
    },
    Result {
        id: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        response: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<BridgeError>,
    },
    Changed {
        thread_ids: Vec<String>,
        list: bool,
    },
    /// Live model text. Defined by the design; nothing produces it until E3 (see `seam`).
    #[allow(dead_code)]
    Stream {
        thread_id: String,
        cursor: String,
        text: String,
        gap: bool,
    },
    Resync,
    Owner {
        event: OwnerEvent,
        owner: OwnerState,
    },
    /// A frame the tab sent could not be used (not tied to a call id).
    Error {
        error: BridgeError,
    },
}
