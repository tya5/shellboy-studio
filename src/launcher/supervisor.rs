/// Decisions from one child lifetime; bridge reachability is deliberately absent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ChildExit {
    Clean,
    BeforeReady(String),
    Crash(String),
}

pub(super) fn classify(
    ready: bool,
    status_success: Option<bool>,
    status_text: String,
    startup_failure: Option<String>,
) -> ChildExit {
    if status_success == Some(true) {
        ChildExit::Clean
    } else if ready {
        ChildExit::Crash(status_text)
    } else {
        ChildExit::BeforeReady(startup_failure.unwrap_or(status_text))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Decision {
    Stop,
    ShowFailure(String),
    Retry { reason: String },
}

/// Chooses whether an unexpected post-ready exit gets one immediate restart.
#[derive(Debug, Default)]
pub(super) struct RestartState {
    automatic_restart_available: bool,
}

impl RestartState {
    pub(super) fn new() -> Self {
        Self {
            automatic_restart_available: true,
        }
    }

    pub(super) fn explicit_exit(&mut self, restart: bool) -> bool {
        if restart {
            self.manual_start();
        }
        restart
    }

    pub(super) fn available(&self) -> bool {
        self.automatic_restart_available
    }

    pub(super) fn manual_start(&mut self) {
        self.automatic_restart_available = true;
    }

    pub(super) fn exited(&mut self, ready: bool, exit: ChildExit) -> Decision {
        match exit {
            ChildExit::Clean => Decision::Stop,
            ChildExit::BeforeReady(reason) => Decision::ShowFailure(reason),
            ChildExit::Crash(reason) if !ready => Decision::ShowFailure(reason),
            ChildExit::Crash(reason) if self.automatic_restart_available => {
                self.automatic_restart_available = false;
                Decision::Retry { reason }
            }
            ChildExit::Crash(reason) => Decision::ShowFailure(reason),
        }
    }
}

pub(super) fn ready_instance_line(line: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<serde_json::Value>(line).ok()?;
    (value.get("event")?.as_str()? == "ready")
        .then(|| value.get("instance_id")?.as_str().map(str::to_owned))?
}

pub(super) fn startup_error_line(line: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<serde_json::Value>(line).ok()?;
    let error = value.get("error")?;
    let message = error.get("message")?.as_str()?;
    let hint = error.get("hint").and_then(|hint| hint.as_str());
    Some(match hint {
        Some(hint) if !hint.is_empty() => format!("{message} {hint}"),
        _ => message.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_success_crash_and_typed_pre_ready_failure() {
        assert_eq!(
            classify(true, Some(true), "clean".into(), None),
            ChildExit::Clean
        );
        assert_eq!(
            classify(true, Some(false), "exit 1".into(), None),
            ChildExit::Crash("exit 1".into())
        );
        assert_eq!(
            classify(
                false,
                Some(false),
                "exit 1".into(),
                Some("bad config".into())
            ),
            ChildExit::BeforeReady("bad config".into())
        );
        assert_eq!(
            classify(false, None, "wait failed".into(), None),
            ChildExit::BeforeReady("wait failed".into())
        );
    }

    #[test]
    fn recognizes_only_core_ready_records_and_preserves_typed_startup_reason() {
        assert_eq!(
            ready_instance_line(br#"{"event":"ready","state":"ready","instance_id":"owned"}"#)
                .as_deref(),
            Some("owned")
        );
        assert_eq!(
            ready_instance_line(br#"{"event":"stopped","state":"stopped","instance_id":"owned"}"#),
            None
        );
        assert_eq!(ready_instance_line(b"not json"), None);
        assert_eq!(
            startup_error_line(
                br#"{"ok":false,"error":{"message":"bad config","hint":"check config"}}"#
            ),
            Some("bad config check config".into())
        );
        assert_eq!(startup_error_line(br#"{"event":"ready"}"#), None);
    }

    #[test]
    fn post_ready_crash_retries_immediately_then_pre_ready_failure_stops_with_reason() {
        let mut state = RestartState::new();
        assert_eq!(
            state.exited(true, ChildExit::Crash("Core crashed".into())),
            Decision::Retry {
                reason: "Core crashed".into()
            }
        );
        // Readiness between exits does not replenish the launch's one-shot budget.
        assert_eq!(
            state.exited(true, ChildExit::Crash("again after ready".into())),
            Decision::ShowFailure("again after ready".into())
        );
        state.manual_start();
        assert_eq!(
            state.exited(true, ChildExit::Crash("after manual Start".into())),
            Decision::Retry {
                reason: "after manual Start".into()
            }
        );
        assert_eq!(
            state.exited(false, ChildExit::BeforeReady("bad config".into())),
            Decision::ShowFailure("bad config".into())
        );
    }

    #[test]
    fn explicit_stop_never_spawns_and_explicit_restart_restores_one_crash_retry() {
        let mut state = RestartState::new();
        let crash = || ChildExit::Crash("fixture exit".into());
        assert!(matches!(
            state.exited(true, crash()),
            Decision::Retry { .. }
        ));
        assert!(!state.explicit_exit(false));
        assert!(!state.available());
        assert!(state.explicit_exit(true));
        assert!(state.available());
        assert!(matches!(
            state.exited(true, crash()),
            Decision::Retry { .. }
        ));
        assert!(matches!(
            state.exited(true, crash()),
            Decision::ShowFailure(_)
        ));
    }

    #[test]
    fn pre_ready_failure_and_clean_exit_do_not_retry() {
        let mut state = RestartState::new();
        assert_eq!(
            state.exited(false, ChildExit::Crash("startup".into())),
            Decision::ShowFailure("startup".into())
        );
        assert_eq!(
            state.exited(false, ChildExit::BeforeReady("typed reason".into())),
            Decision::ShowFailure("typed reason".into())
        );
        assert_eq!(state.exited(true, ChildExit::Clean), Decision::Stop);
    }
}
