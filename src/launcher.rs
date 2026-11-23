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

#[cfg(any(test, target_os = "macos", windows))]
mod startup {
    use crate::owner::{Owner, startup_probe};
    use shellboy::protocol::{ApiError, ErrorCode, PROTOCOL_VERSION};

    pub(super) const OWNER_FAILURE: &str =
        "The bundled owner failed. See studio.log and owner.log.";

    #[derive(Debug)]
    pub(super) struct Refusal {
        pub(super) reason: String,
        diagnostic: Option<String>,
    }

    impl From<String> for Refusal {
        fn from(reason: String) -> Self {
            Self {
                reason,
                diagnostic: None,
            }
        }
    }

    impl From<&str> for Refusal {
        fn from(reason: &str) -> Self {
            reason.to_owned().into()
        }
    }

    impl Refusal {
        pub(super) fn message(&self) -> &str {
            self.diagnostic.as_deref().unwrap_or(OWNER_FAILURE)
        }

        fn from_probe(error: ApiError) -> Self {
            fn mismatch(error: &ApiError) -> Option<u32> {
                if error.code != ErrorCode::ProtocolMismatch {
                    return None;
                }
                let details = error.details.as_ref()?;
                let client = details.get("client_protocol_version")?.as_u64()?;
                let owner = u32::try_from(details.get("owner_protocol_version")?.as_u64()?).ok()?;
                (client == u64::from(PROTOCOL_VERSION) && owner != PROTOCOL_VERSION)
                    .then_some(owner)
            }
            let diagnostic = mismatch(&error).map(|owner| format!(concat!(
                "この Studio は protocol {studio} の Core と組み合わせます。つないだ owner は protocol {owner} です。データの置き場をバックアップしてから、owner の shellboy.exe をこの Studio に同梱のものに入れ替えてください。",
                "\n\n",
                "This Studio requires Core protocol {studio}. The owner uses protocol {owner}. Back up the data directory, then replace the owner's shellboy.exe with the copy bundled with this Studio."
            ), studio = PROTOCOL_VERSION, owner = owner));
            Self {
                reason: error.message,
                diagnostic,
            }
        }
    }

    /// Returns true for an existing compatible owner, false only when none is running.
    pub(super) async fn probe(owner: &impl Owner) -> Result<bool, Refusal> {
        match startup_probe(owner).await {
            Ok(()) => Ok(true),
            Err(error) if error.code == ErrorCode::AppNotRunning => Ok(false),
            Err(error) => Err(Refusal::from_probe(error)),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::{Value, json};
        use shellboy::protocol::{Command, Origin, Response};

        struct FakeOwner(ApiError);
        impl Owner for FakeOwner {
            async fn call(
                &self,
                command: Command,
                operation: Option<String>,
                origin: Option<Origin>,
            ) -> Result<Response<Value>, ApiError> {
                assert!(matches!(command, Command::ThreadList(_)));
                assert!(operation.is_none() && origin.is_none());
                Err(self.0.clone())
            }
        }

        #[tokio::test]
        async fn attach_refusal_reports_both_protocols_in_both_languages() {
            let other = PROTOCOL_VERSION + 1;
            let owner = FakeOwner(
                ApiError::new(ErrorCode::ProtocolMismatch, "fixture mismatch").details(json!({
                    "client_protocol_version": PROTOCOL_VERSION,
                    "owner_protocol_version": other,
                })),
            );
            let refusal = probe(&owner).await.err().expect("attach must be refused");
            assert_eq!(refusal.reason, "fixture mismatch");
            let message = refusal.message();
            assert!(message.contains(&format!("protocol {PROTOCOL_VERSION} の Core")));
            assert!(message.contains(&format!(
                "owner は protocol {other} です。データの置き場をバックアップ"
            )));
            assert!(message.contains(&format!(
                "Core protocol {PROTOCOL_VERSION}. The owner uses protocol {other}. Back up"
            )));
            assert!(message.contains("shellboy.exe"));
            assert!(!message.contains("版は不明"));
            println!("STUDIO21_DIAGNOSTIC={}", json!(message));
        }

        #[tokio::test]
        async fn non_version_refusals_keep_generic_diagnostic() {
            for code in [ErrorCode::ProtocolMismatch, ErrorCode::IoFailed] {
                let refusal = probe(&FakeOwner(ApiError::new(code, "fixture refusal")))
                    .await
                    .err()
                    .expect("attach must be refused");
                assert_eq!(refusal.message(), OWNER_FAILURE);
            }
        }
    }
}
