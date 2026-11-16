# Accepted Window Thread Authority

The accepted Window binding is the authority for saved/live ownership. Its scope is the current ThreadHandle handoff scope, which includes the owner instance id, entry id, and live lifetime (the JSON handoff scope). The publication namespace/container is presentation identity only; it must not substitute for ThreadHandle scope.

A saved assistant row can affect live ownership only when its `provenance.attempt_id` matches a live record in the current binding scope. Missing or mismatched provenance remains an ordinary saved row. `text_complete=false`, excerpt truncation, and body loading are saved-row facts, not completion or retirement authority.

The shared AcceptedView commit hook performs the accepted publication and matching live release before manual listeners are notified. Rejected publications do not release. This avoids a caller-side reconcile authority and prevents observers from seeing accepted saved content alongside a matching live source.

The remaining withdrawal removes proof/receipt/staged transfer and status-driven terminal-read ownership from active paths and mechanism tests. It preserves current binding, epoch, cancellation, ordinary saved body loading, incomplete-body behavior, wrong-scope/missing/mismatch controls, and publication re-entry/rejection semantics.
