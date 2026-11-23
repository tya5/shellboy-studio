use std::time::Duration;

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
    Retry { reason: String, after: Duration },
}

/// Per-launcher retry progression, bounded by the existing owner-start deadline.
#[derive(Debug)]
pub(super) struct RestartState {
    delay: Duration,
    cap: Duration,
}

impl RestartState {
    pub(super) fn new(cap: Duration) -> Self {
        Self {
            delay: Duration::from_secs(1),
            cap,
        }
    }

    pub(super) fn exited(&mut self, ready: bool, exit: ChildExit) -> Decision {
        match exit {
            ChildExit::Clean => Decision::Stop,
            ChildExit::BeforeReady(reason) => Decision::ShowFailure(reason),
            ChildExit::Crash(reason) if !ready => Decision::ShowFailure(reason),
            ChildExit::Crash(reason) => {
                let after = self.delay.min(self.cap);
                self.delay = self.delay.saturating_mul(2).min(self.cap);
                Decision::Retry { reason, after }
            }
        }
    }
}

pub(super) fn is_ready_line(line: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(line)
        .ok()
        .is_some_and(|value| value.get("event").and_then(|event| event.as_str()) == Some("ready"))
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
    fn recognizes_only_core_ready_records_and_preserves_typed_startup_reason() {
        assert!(is_ready_line(br#"{"event":"ready","state":"ready"}"#));
        assert!(!is_ready_line(br#"{"event":"stopped","state":"stopped"}"#));
        assert!(!is_ready_line(b"not json"));
        assert_eq!(
            startup_error_line(
                br#"{"ok":false,"error":{"message":"bad config","hint":"check config"}}"#
            ),
            Some("bad config check config".into())
        );
        assert_eq!(startup_error_line(br#"{"event":"ready"}"#), None);
    }

    #[test]
    fn retries_only_post_ready_crashes_with_growing_capped_delay() {
        let mut state = RestartState::new(Duration::from_secs(15));
        assert_eq!(
            state.exited(true, ChildExit::Crash("first".into())),
            Decision::Retry {
                reason: "first".into(),
                after: Duration::from_secs(1)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("second".into())),
            Decision::Retry {
                reason: "second".into(),
                after: Duration::from_secs(2)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("third".into())),
            Decision::Retry {
                reason: "third".into(),
                after: Duration::from_secs(4)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("fourth".into())),
            Decision::Retry {
                reason: "fourth".into(),
                after: Duration::from_secs(8)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("fifth".into())),
            Decision::Retry {
                reason: "fifth".into(),
                after: Duration::from_secs(15)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("sixth".into())),
            Decision::Retry {
                reason: "sixth".into(),
                after: Duration::from_secs(15)
            }
        );
    }

    #[test]
    fn pre_ready_failure_and_clean_exit_do_not_retry() {
        let mut state = RestartState::new(Duration::from_secs(15));
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

    #[test]
    fn backoff_keeps_growing_across_successful_ready_periods() {
        let mut state = RestartState::new(Duration::from_secs(15));
        assert_eq!(
            state.exited(true, ChildExit::Crash("one".into())),
            Decision::Retry {
                reason: "one".into(),
                after: Duration::from_secs(1)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("two".into())),
            Decision::Retry {
                reason: "two".into(),
                after: Duration::from_secs(2)
            }
        );
        assert_eq!(
            state.exited(true, ChildExit::Crash("again".into())),
            Decision::Retry {
                reason: "again".into(),
                after: Duration::from_secs(4)
            }
        );
    }
}
