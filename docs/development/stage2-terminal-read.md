# Stage 2 Internal Read Ticket - Design Checkpoint

DESIGN ONLY: no exported product API, dispatch or implementation approved.
Canonical clarification: FILESHA256
1a5991568334b2d6d1f8d5e6c9918a9df55e50425603eb7729500a63c3e2a7ae.

## Typed Signatures (Proposed)

```ts
// data/src/store.ts: internal client-only identities, not serialized RPC types.
type TerminalReadTicketId = string & { readonly terminalTicket: unique symbol };
type SelectedRequestId = string & { readonly selectedRequest: unique symbol };
interface SelectedCanonicalRequest {
  readonly id: SelectedRequestId;
  readonly args: Readonly<HistoryWindowArgs>; // existing strict operation args
  // captured selection anchor/range; items:true; <=200 NODE entries
}
interface TerminalReadTicket {
  readonly id: TerminalReadTicketId;
  readonly request: SelectedCanonicalRequest;
  readonly receipt: TerminalPersistedProof;
}
type TicketOutcome =
  | { readonly phase: 'queued' | 'reading'; readonly ticket: TerminalReadTicket }
  | { readonly phase: 'settled'; readonly ticket: TerminalReadTicket;
      readonly result: Outcome<HistoryWindowResult> }
  | { readonly phase: 'unavailable'; readonly reason:
      'unsupported' | 'budget-exhausted' | 'capacity' | 'cancelled' };
interface OwnedTerminalReadLease {
  readonly ticket: TerminalReadTicket;
  readonly state: ReadonlySignal<TicketOutcome>;
  cancel(): void; // releases this requester only, idempotent
}
// Existing ThreadHandle instance and its ORIGINAL read qualification are mandatory.
requestTerminalRead(
  qualification: ThreadReadQualification,
  receipt: TerminalPersistedProof,
  request: SelectedCanonicalRequest
): OwnedTerminalReadLease | TicketOutcome;
```

Names are frozen for this review, not yet product exports. Outcome/HistoryWindowResult/
HistoryWindowArgs mean the existing imported operation result/args types; no copied
wire types. The implementation must use their actual exported names, or amend this
checkpoint BEFORE code if unavailable. The ticket object is immutable; it carries
no callback or Window/presentation object into the data layer.

```ts
// ui-core/src/window.ts: one Window-owned adapter, not a second read queue.
interface WindowTerminalTarget {
  readonly ticketId: TerminalReadTicketId;
  readonly requestId: SelectedRequestId;
  readonly ref: WindowAcceptedSnapshot;
  readonly capability: AcceptedCapability;
}
// Internal Window adapter; caller supplies the original handle qualification.
prepareTerminalRead(handle: ThreadHandle, original: ThreadReadQualification,
  receipt: TerminalPersistedProof): OwnedTerminalReadLease | TicketOutcome;
// Window retains target privately; no arbitrary external ref rebind.
applyTerminalRead(lease: OwnedTerminalReadLease): boolean;
cancelTerminalRead(ticketId: TerminalReadTicketId): void;
```

prepare captures exact accepted ref/cap, selected request and receipt before data
admission, storing a private WindowTerminalTarget. It subscribes once per lease.
apply looks up that private target and accepts only the current exact ref/cap and
request identity, original qualification and matching immutable receipt. A stale
result simply returns false and releases its lease: it MUST NOT write even a
stale-target reason into a revoked ref. New target = new explicit prepare under
fresh authority, not mutation of the old target or automatic retry.

## Sole Read Owner / Budget / Fanout

Owner is ShellboyData's EXISTING handoffRead permit plus ThreadEntry's existing
resolver. Status and this refresh both call the existing Handoff.takeRead BEFORE
dispatch. Eight starts TOTAL, one shared in-flight lookup, refs<=64, typed page
<=200 NODE entries. No ordinary Window.read call for terminal refresh.

Each existing receipt slot owns ONE marker (max eight per ThreadEntry), including
queued/reading/settled state. Automatic admission uses it once per receipt lifetime;
settled never auto-requeues on hints. A global pending-ticket array is NOT added:
existing entry resolver iteration owns queued markers. Existing entry/watch bounds
and disposal remain unchanged. No scan/poll/task per requester.

Exact coalescing key = same owned ThreadEntry + original qualification identity +
scope + receipt identity + selected request id. Same key returns a new lease on
ONE marker/result, not another start. Different selected request never joins it.
At most ONE Window lease plus ONE data-resolver lease per marker (fanout<=2), so
there is no unbounded subscriber queue. Additional requester gets capacity reason.
Each lease holds one result signal reference; one immutable result is shared.

If an ordinary Window read already exists, do NOT join a budget-free result merely
because its args look equal: the first implementation waits for its completion
without dispatching, then prepares a fresh current target through this sole owner.
There is no undocumented cross-owner result fanout. Only operations originally
admitted by this permit may coalesce. This deliberately conservative rule avoids
silently merging two existing owners. A later optimization needs separate review.

Explicit manual retry follows existing qualified retryHandoff budget-reset policy;
it may reset the same settled marker once as part of that operation. Hints/target
changes/receipt refinement NEVER replenish reads. No new admission guarantee.

## Dispatch Pseudocode And Cancellation

```
prepare: validate original token/scope/receipt + current target + capability
  if history.window unsupported: publish same-current presence unsupported; NO RPC
  capture selected request id/args/target; register/join bounded receipt marker
resolver: while current existing permit available, choose one queued marker
  validate original Cancel/epoch/token and marker lease count
  if !takeRead(): settle budget-exhausted (no dispatch)
  mark reading; revalidate AFTER notification; dispatch existing history.window
  after await: validate original token/Cancel/epoch; otherwise drop result
  publish immutable outcome to active leases (no presentation callback)
Window lease listener:
  revalidate exact private target/ref/cap/request BEFORE clone/stage
  stage available canonical rows + terminal receipt + CASE presence atomically
  revalidate BEFORE commit and AFTER subscriber notification
  invalid target => cancel lease, no write to old ref, no automatic fresh prepare
```

Requester cancel removes only its lease, never cancels another requester's read.
When last lease disappears, remove the queued REQUEST and lease references but
MANDATORILY settle the admitted marker in the SAME receipt slot; if reading, cancel its existing
Cancel child and discard late result. No additional read can start until the
existing permit is released in finally. close/pause/cancelReads/owner change/
unwatch/dispose invalidate authority BEFORE publishing cancellation, release all
leases and request references. Cancel outcome is informational, not authority to
write into a dead Window. Marker MUST remain settled within its existing receipt
slot to prevent automatic replay; no new tombstone collection or lifetime growth.

## Presence Consumer / No-Window

Window accepted snapshot publishes terminal receipt + available rows + presence
in the first swap, before original synchronous end. Leases retain receipt IDs,
not old live text. Pending/queued/reading maps to Notifications, one confirmation
line; settled partial/missing/error/budget/unsupported maps to Problems with explicit
CLIENT reason. No Work category/tool count/fake saved row. Current canonical
availability accounting suppresses duplicate presence but never claims answer
complete. Unknown kind remains unknown, not a guessed assistant node.

NO history.window capability: legacy accepted bundle publishes presence-only
unsupported with available history and live-off receipt. It never creates a
Window ticket or calls history.window. Existing Legacy original-token bundle is
the sole source; no independent work read or token recapture.

## Call Sites / Ownership

- data/src/store.ts ThreadEntry marker/permit/requestTerminalRead and existing
  resolveHandoff dispatch: S. data operations/protocol unchanged.
- ui-core/src/window.ts terminal snapshot/prepare/apply/cancel: S.
- ui-core/src/legacy-presentation.ts unsupported presence snapshot: S, separate
  from Stage1 representation GC logic; no fetch.
- ui-core/src/model.ts ownership binding/dispose + shared Console renderer/CASE
  projection: D, only after immutable author signatures; S edits none of these.

Required tests after review/leader implementation approval: one held actual
canonical response (liveoff+available+presence then typed arrival), coalesce one
start/fanout<=2/lastleasecancel, global permit serialization/status budget inclusion,
no-window zero RPC, partial/missing/error/budget, revoked target zero publication,
post-notify invalidation, disposal. Not a new fullsuite or Stage1 rerun.

No future freshness, ninth durable cap fix, barrier implementation, fab0 adoption,
Core API/schema change, installed swap or runtime real-data access in this design.

## Frozen Lifecycle Clarifications (S6 Conditional Review)

Automatic-once is consumed at FIRST qualified admission, including queued,
pre-dispatch, cancellation, failure and budget denial. Last-lease cancellation
MUST NOT remove/reset this marker while its original receipt scope remains valid.
A later prepare, changed target/request, failed dispatch or receipt refinement
returns the settled outcome and cannot authorize a second automatic read. Only
entire original-scope invalidation releases the marker with its receipt, or the
existing explicitly qualified MANUAL retry starts a separately identified manual
operation under documented retry budget reset. Manual is not automatic eligibility.

SelectedRequestId is owned by the Window's private registry, not freshly minted
per prepare. One registry entry per existing receipt slot (<=8 per Window): original
qualification identity + immutable receipt identity + exact selected args + target
ref/cap identity maps to a stable ID. Repeated prepare for that exact tuple joins
that same ID/marker, subject to fanout<=2. A changed target creates a new explicit
transaction/ID but MUST reuse the consumed per-receipt admission marker and hence
cannot dispatch automatically again. Old transaction leases are cancelled and
references released; no registry history/queue grows beyond the eight live slots.
Disposal/original-scope invalidation clears the registry and leases. Matching is
structural strict operation args, not body/text/time or opaque cursor decoding.

Resolved source imports (checked, not speculative): HistoryWindowArgs and
HistoryWindowResult from data/src/protocol.ts; Outcome from data/src/errors.ts;
ReadonlySignal from @preact/signals-core; TerminalPersistedProof from handoff.ts;
ThreadReadQualification from store.ts; AcceptedCapability from
ui-core/src/accepted-view.ts. No copied wire DTOs or new package dependency.

Admission validates actual strict HistoryWindowArgs: items === true, finite
nonnegative integer before/after under the existing operation limits, and total
requested node entries <=200 (including an anchor if counted by that operation).
Readonly typing is not validation. Cancel immediately removes ticket/target maps
and lease references; the separate settled per-receipt once marker remains.
apply(false) never rewrites the old presence. A fresh prepare requires an explicit
new target operation, not an automatic listener retry.

## Implementation Checkpoint

Data's private registry authenticates receipt values against the exact status-owned
proof before marker admission. Window's source snapshot is cloned by AcceptedView;
this validation compares immutable proof fields, not a new authority from arbitrary
strings. Marker proof identity is the private registered object. The prepared
Window target retains the original handle token; consumers MUST NOT capture another
qualification merely to call prepare. Legacy class uses its own original token and
never dispatches a Window read.

The first implementation conservatively rejects a revision-changing result with
selection-gap presence; it does not implement automatic target rebinding. Ordinary
Window reads are not joined. If they are active, presence becomes pending/read-
inflight and the caller receives capacity; a later explicit fresh preparation is
needed. Repeated existing prepares return the same live target/lease, not unbounded
leases. Data-level coalescing permits at most two leases.

Explicit retryHandoff first invalidates the old epoch using existing reconcile,
then clears terminal markers as a MANUAL operation. Old tokens/targets cannot use
that reset. Hints, cancel-last-lease and target changes do not clear markers.
Receipt registry remains at eight; no ninth durable retirement/cohort refill.

Controls distinguish original-source missing presence (one real red) from initial
fixture failures: a Window fixture incorrectly declared an unloaded second node in
its ordinary initial tail and caused repeated fixture reads; stopped only that own
job. A later fixture lacked advertised history.window and correctly got unsupported.
Those logs are retained and are not product regressions. The corrected public-cap
actual Store/O/Window pipeline supplies canonical selection and original status
proof; it is not actual browser or user-Thread evidence.

D must project terminalPresence through canonical CASE Notifications (pending/
reading) or Problems (settled client reason), with no new category/fake saved node.
Until that consumer and its original-token binding are integrated, no visible-gap
fix or full runtime matrix acceptance is claimed. Barrier/fab0 remain outside scope.

### Overlap Safety Correction

The initial refresh merge could replace already authorized row bodies at the same
node ID/ordinal. Same selection revision does not authorize that replacement. The
correction rejects the ENTIRE page when any overlapping row differs structurally,
retains all existing saved rows and settles partial-items presence. This includes
richer-looking replacements: without an adopted canonical merge proof no content
length, type or completeness heuristic grants replacement authority. New rows are
admitted only when every overlap is identical and the existing contiguous-run /
capacity guards also pass. Synchronous request completion rechecks the original
qualification and exact target before any reason publication.
