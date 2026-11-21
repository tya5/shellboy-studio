# Own Send Visible Handoff

Source checkpoint: installed Studio d60d29d matches the reviewed renderer/model
branches on this worktree. Actual USER node IDs and publications are unknown;
these are confirmed unsafe source paths, not proof of the observed Thread cause.

## First Divergence

- AppModel.pendingOwnSaved retires on current ref.rows canonical node-ID presence.
- PendingOwnMessageView independently hides on nodes.some with that same ID.
- The actual canonical projection can instead emit deferred/empty/partial Work,
  filter a pending node, or omit a node outside the selected rows. Neither
  node-ID-only branch proves a readable user message was displayed.
- Window current=false excludes the local trailing view; Legacy current=false
  returns null. Public read qualification is incorrectly used to gate the local
  mutation presentation. Both current checks must remain strict for public data.

## One Owner

One typed core presentation function will receive the exact accepted ref identity,
its current qualification, the actual final canonical projection used by the UI,
and the bounded mutation-owned local operations. It returns ONE result containing
that projection with exact-ID incomplete counterparts suppressed, displayed
complete saved user IDs, local rows, and retirement decisions. Model and UI consume
that result; neither may independently scan nodes or reproject history.

The helper consumes existing CASE decisions and explicit typed completeness. It
is not a classifier and cannot authorize aggregate text or infer a body from
node kind, matching prose, timestamps, position, or an absent completeness flag.
Retirement is committed only after the UI installs the result and after checking
that same ref is still current. A send/deliver call cannot preemptively retire.

| Input State For Exact ACK ID | Public Row Owner | Local Row Owner | Ledger Retirement |
| --- | --- | --- | --- |
| ACK but no saved candidate | None | Original bounded operation | None |
| Metadata-only/deferred/empty candidate | No replacement user text | Original operation | None |
| Partial typed user text or absent completeness proof | Suppressed exact counterpart | Original full submitted text | None |
| Complete readable typed user in final qualified displayed projection | Canonical saved user | None | Same-result post-install commit |
| ID only outside final displayed projection/range or explicitly suppressed | None | Original operation | None |
| Public ref stale/current=false | No new public authority | Original operation under mutation identity | None |
| Saved arrives before ACK | Saved independently, no body/position join | Sending until exact receipt binds identity | Only after bound identity and qualified representation |
| New draft during ACK | Unchanged | Submitted generation only | Never clear different-generation draft |
| Unknown/unreachable owner | No new public read authority | Original operation retained | None |
| Route/handle change or confirmed different owner | Existing cancellation semantics | Local scope invalidated | Release old bounded scope |

Window and Legacy must use the same local-presentation consumer, including
no-ref/invalid-ref paths; no alternate trailing-only view may hide the ledger.
Exact partial counterparts must not render next to the full local message.
Public assistant terminal live-off policy is unrelated and remains unchanged.

## Validation Boundary

Before the source repair, reproduce both node-ID-only branches using actual App
metadata-only publication. Then verify each publication frame has exactly one
readable owner across metadata/deferred/partial/complete, ACK-first/saved-first,
held reads, stale refresh and non-displayed candidates. Keep exact-ID negatives,
new draft generation, original operation reconnect/retry and navigation controls.
No real user sends, browser, database/RPC reads, polling, timer or capacity changes.

## Frozen Result Receipt And Install Point

The implementation-local generic signature (not a new data/public RPC) is:

```ts
type OwnSendPresentation<Ref> = Readonly<{
  token: object; ref: Ref | undefined; scope: string;
  projection: ConversationProjection;
  displayedSavedUserIds: ReadonlySet<string>;
  localRows: readonly PendingOwnMessage[];
  retire: readonly Readonly<{ operationId: string; messageId: string; source: PendingOwnMessage }>[];
}>;
```

Each result captures the original immutable mutation entry object as its operation
version/generation, in addition to operation ID and mutation scope. The UI uses
one result for canonical filtered rows AND local rows. A shared Window/Legacy
presentation consumer installs that result, then acknowledges the exact token in
a layout effect. No state changes occur during render. The model commit takes
that same object plus the original ref-current validator, checks current mutation
route/handle/known-owner and source-entry identity, and removes only its captured
retire entries. It neither scans nodes nor builds another projection. Repeated
acknowledgments are inert; notify only when the ledger actually changes. A stale
or superseded result token cannot acknowledge a newer installed result.

Complete means CASE-authorized user source, explicit textComplete === true,
nonempty authorized text, and inclusion in the final visible canonical projection.
No implicit legacy completeness inference is added. Unknown/deferred/partial
exact counterparts are suppressed while the local operation owns display.

## Multiple Submissions And Ordering Checkpoint

New USER observation: multiple own rows changed order, and a reported preceding
message was not independently confirmed in the leader input history. No delivery
loss, saved order or actual node identity is established from that observation.
The structural repair is not yet installed; recurrence remains an open incident.

The bounded mutation ledger has genuine submission order, but no canonical
selection ordinal for an unrepresented operation. Current trailing concatenation
puts pending rows after all saved rows. If submission B becomes saved before A,
canonical B followed by trailing A reverses their local relative order. This is
a confirmed source risk, not evidence of the USER's particular transaction.

| Frame | Required Observation | Authority Constraint |
| --- | --- | --- |
| A then B ACK, neither saved | A then B once each, full local texts | Original ledger order |
| B metadata/partial arrives first | A then B local owners once each | Metadata cannot retire or reorder either |
| B complete arrives before A | No silent B/A inversion | Needs an explicit local/canonical placement contract |
| A and B complete in canonical order | Exact-ID replacement once, text retained | Public canonical order; no inferred ordinals |
| Public canonical order contradicts local submission order | Record conflict, do not silently sort | Canonical and local authorities differ |
| Refresh stale or result ACK revoked | Local owners remain; no loss or duplicate | No stale public replacement |

The ONE presentation owner must address this boundary explicitly. Local-tail
retention of a contiguous unresolved submission cohort is a possible policy, but
placing already-authorized saved rows there changes canonical presentation and
requires a reviewed contract. It is NOT implicitly authorized by node ID, body,
time, a fabricated ordinal, or a new sort rule. No indefinite extra ledger is
introduced: existing eight-entry/submitted-byte bounds remain in force.

Actual frame controls must exercise two or more ACKs, reversed saved arrival,
metadata/partial intermediates and stale refresh, observing operation IDs, row
order, readable text owner and counts before/after installation and retirement.

## Cross-Domain Follow-Up: Build-Free Typed Checkpoint

Installed223 original controls prove four local rows survive but follow the new
assistant in DOM. The original cohort result did not own a unified region.

`own-send-region.ts` declares an observation and reservation descriptor only.
An observation is made from the installed result, with its exact token/ref/scope,
actual revision and actual final canonical node/item tail identity. Its original
validator is checked at reservation; it is not permission to use future refs.
An empty qualified history is a distinct `beginning`, never a guessed index.
One reservation descriptor is held with the existing eight-entry local cohort.

Next implementation order after finite design verdict:

1. UI final projection result publishes qualified-tail observation only after
   installation; the model never independently normalizes/scans wire history.
2. FIRST unresolved deliver checks that exact installed observation is still
   current, captures its immutable descriptor before notifying the sending row.
   Further same-cohort sends keep it; scope disposal clears it with the ledger.
3. One helper validates the boundary in the new qualified canonical projection,
   preserving original canonical order and excluding only exact cohort ACK IDs.
4. One region result renders prefix, local cohort, suffix in that order. Its
   entire installation and retirement use the existing cohort CAS guard.
5. Missing/evicted/incompatible boundaries retain local content and report
   placement-unqualified; no silent first/last/index substitution is allowed.

Canonical nodes may contain several items. A tail item must be the actual last
member of that node in the final CASE sequence, not just a matching node ID.
A Work group containing that member must not be split into two groups with the
same key. At reservation, the proved tail is the last sequence/member boundary;
a later group extension requires explicit membership validation or an honest
unqualified result. No new grouping/classifier is authorized in the renderer.

No executable placement behavior, tests, or claimed validation is added by this
typed preparation checkpoint. Original223 two RED controls remain unchanged.

## Q1/Q2 Convergence Correction (Contract fc1cf815)

Public selection revision increments on normal appends. The previous static53
qualification proved conservative placement and before/at conflict handling, NOT
normal-append liveness. Keep that evidence and its limitation; do not erase it.

Unresolved local placement still uses the old boundary continuity check. Complete
replacement instead uses the FRESH current final canonical projection and its
post-install/cohort/owner CAS. It does not revive an old ref or require old/new
revision equality. Same-revision qualified before/at conflicts remain conflicts.

A recorded plain message.send operation creates one input text part under the
reviewed producer contract. Record that route at reservation and carry its fact
from the original operation across ACK. Only its exact ACK user node with exactly
one nonempty text item, explicit text_complete=true, and an actual final displayed
complete user row can replace local submitted text. Part completeness alone is
not a whole-node claim. Multi-item, unavailable, partial, unknown route, excerpt,
and absent items keep the local body. No body comparison, opaque item-path parse,
new read, history.get pagination or private prefix witness is introduced.

The same four-ACK controls now use revision1->6 on saved arrival. Window typed
short plain rows converge and retain canonical DOM order/assistant identity.
Actual history.list-style excerpt-only rows deliberately retain all four local
bodies; that is a supported evidence limit, not a successful canonical handoff.
Legacy full-typed synthetic tests remain renderer/CAS tests only, not evidence that
history.list supplies typed items. Continued sends can extend the existing cohort
and postpone convergence until the fixed eight-slot backpressure applies. That
starvation/limit remains unresolved; no new seal, eviction or queue is adopted.
