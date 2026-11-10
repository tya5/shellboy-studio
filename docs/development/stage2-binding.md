# Stage 2 Original Qualification Binding - Tiny API Checkpoint

Proposed ConversationWindow methods:

```ts
bindTerminalHandle(handle: ThreadHandle): boolean;
prepareBoundTerminalRead(receipt: TerminalPersistedProof):
  OwnedTerminalReadLease | TicketOutcome;
isTerminalHandleCurrent(handle: ThreadHandle): boolean;
```

Window owns one binding {handle, originalToken, scope}. First bind validates a live
Window/current accepted ref, captures qualification ONCE inside this owner, checks
it and scope again, then installs. Repeated bind of the identical current handle
is inert true (no recapture); invalidated/other handle returns false. No replacement
or rebind in the same Window lifetime. Dispose cancels all leases then clears binding.
An existing summary transition is not silently recaptured: bind refuses while one
exists; a later summary recapture invalidates this binding, and terminal reads deny
rather than rebuilding/recapturing it. Separate lifetime coordination remains D's
existing Window disposal/creation ownership, not a new reset rule.

prepareBoundTerminalRead checks original token/scope/handle.closed plus current
accepted ref/cap, calls existing prepareTerminalRead(handle, originalToken, receipt),
and rechecks after any synchronous notifications. Invalid binding cancels all its
leases, returns cancelled and never publishes a reason into a revoked target.
The bound handle is not closed by Window (D remains its owner). No field parsing,
new read, automatic repeat admission or independent D token capture.

D call sites: after creating the owned Window and its ThreadHandle call bind once;
when an accepted receipt requires canonical availability call prepareBoundTerminalRead
only. D never calls captureReadQualification or passes a fabricated token. Existing
D dispose closes Window subscriptions then owned handle. Bind failure must deny,
not create another class/Window solely to game the qualification.

Controls in existing terminal-presence-read.test.ts: bind once/repeated inert,
exact public terminal read via wrapper, cancelReads/handle close/owner change deny,
wrong handle denied, dispose deny; keep existing request post-notify guards and
once marker. No extra API approval loop requested; this checkpoint documents the
owner-local hook missing from initial fba. All read/budget/marker bounds unchanged.

## Summary Conflict Resolution - Required Before Implementation

The earlier statement permitting later summary recapture is SUPERSEDED: that would
unexpectedly invalidate the terminal owner. Window must multiplex ONE original
qualification internally, not ask the handle for a second token. bind is the only
new qualification capture for a bound Window. beginSummaryTransition on the SAME
bound handle borrows binding.originalToken; it never captures a token again.
If bound qualification is invalid or a different handle is supplied, deny summary
transition (no fallback recapture). An already-created unbound summary transition
prevents first bind; do not adopt its token as a general source token. Unbound
legacy summary call sites retain existing behavior until their owned Window is
wired to first bind before summary registration. No external token getter exists.

Minimal source change in beginSummaryTransition:
```
if (terminalBinding exists) {
  if (!isTerminalHandleCurrent(handle)) return undefined;
  token = terminalBinding.originalToken;
} else {
  token = handle.captureReadQualification(); // existing unbound behavior only
}
```

Source basis: store handle holds one qualification slot; each capture invalidates
previous token. Sharing the SAME original binding token preserves the existing
scope/epoch/cancel checks of both transactions. It is not a new Core authority or
an extension of token lifetime. Binding is owned by this Window, not a general
store-level multiplex service. No recapture after epoch/owner/source invalidation.
D binds once before it installs effects that may begin summary registration.

No new subscriptions: isTerminalHandleCurrent and prepare read existing handle
closed/qualification/scope plus accepted ref/cap. Existing D effect owns source
subscriptions and invokes current check; false cancels leases but does not rebuild
to game authority. Window dispose clears targets before dropping the binding;
handle-change denies and cancels old leases. Exact binding cannot be replaced in
that same Window. No automatic owner change/retry requalification is added.

Implementation resolves closure through isReadQualificationCurrent: ThreadHandle
has no public closed signal, so no invented closed field is read. Its existing
qualification predicate covers closed/paused/owner/read-epoch/lifetime/cancel.
Before returning an existing summary transition ID, bound handle qualification is
checked first. After token capture/borrow both token and accepted ref are checked.
Both order controls use actual public terminal proof and only one binding capture.
Initial closed-field failure and missing OwnerEvent fixture type are preserved as
implementation artifacts, not product regression evidence.
