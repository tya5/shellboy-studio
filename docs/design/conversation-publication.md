# Current Conversation Publication

Status: adopted contract for Studio #24, November 15, 2026. Implementation and
qualification are tracked by source SHA. This document is not a claim that the
reported live incident is resolved. The first exact-source three-OS run at
`3abb238` failed the unchanged five-second sustained-reading and selected-window
controls; local green did not qualify that CI run.

## Expected Behavior

Show the current Thread's selected saved rows using their exact identities and
order. Never replace a newer accepted history revision with an older reply.
While a successor read is pending, incomplete, invalid, or rejected by a bound,
keep the last legitimate display for that same Thread. This does not authorize
retaining a deleted row, an old Thread, or a revoked owner as current content.

A readable live answer stays visible until its exact current saved counterpart is
qualified. Switching between the two happens in one accepted publication. An
unrelated answer, canonical human message, tool execution, or local send must not
lose its display because another owner fails. Equal text is not identity.

## Three Responsibilities

**Canonical body authority** comes from the typed current selected history. A
complete canonical item belonging to that Thread/selection can render without a
live owner. Its identity, ordinal, kind, body completeness, and Core revision are
not supplied by overlay ownership. Incomplete assistant text does not gain body
permission from the partial-human display contract. An independently complete
saved sibling is not hidden by an incomplete sibling's preview reservation.

**Live overlay ownership** belongs to the actual held original and its lifetime.
A persisted receipt says that exact attempt has saved identity, not that its body
is available or that the original may be retired. The exact read job/lease owns
in-flight readback. A ninth receipt-capacity refusal cannot replace the readable
source with a staged record that cannot retire. Another still-qualified owner
keeps its own host, body, and container. Source-owned placement records when a
stream began relative to the selected path or a preceding exact original; it is
ordering metadata, not body/read authority.

**Atomic publication** owns one immutable current cut: selected rows, history
revision/total/cursor, body decisions, live ownership, Work metadata, local sends,
placement, and post-commit retirement. A pending candidate never mutates the
accepted cursor or partially replaces buckets. An invalid candidate does not
publish an empty ready plan. Effects use the accepted ref and the same local
owner lifetime; there is no renderer-side registry of saved/body authority.

These are responsibilities of existing data, source, and publication modules, not
three new security frameworks or three independent version clocks.

## One Input Boundary, One Internal Representation

External RPC values pass through their typed decoder and an owned immutable input
constructor. That constructor isolates mutable caller data/getters once, validates
plain values, aliases, cycles, depth and visit limits, and returns either owned
input or an explicit bounded failure. Getter/mutation tests belong to this entry
boundary; moving them is not permission to weaken their assertions.

Internal projection and publication constructors consume those owned typed inputs
and share their immutable graph. They must not treat the whole internal snapshot
as an unknown hostile graph again on every publication. No `Object.isFrozen`
shortcut, generic trusted-data whitelist, old projection cache, or generation
restamp replaces the input constructor. All semantic fields and execution
multiplicity remain represented. Issuer facts stay with their exact typed source;
internal code is not an adversarial consumer that needs repeated whole-graph
fingerprinting to invent permission.

The main publication loop must not stringify the entire canonical/display/Work/
local graph to determine whether it changed. A typed current input change and a
single prepared publication own that transition. Exact graph sharing removes
copies; it does not create another body-authority store. The accepted input is
one projection authority: canonical body, live owner qualification, and
presentation metadata are composed from that input without an unused whole
projection recomputation. This is an architecture invariant, not a deadline
optimization; test-fixture, assertion, and trace overhead remain UNKNOWN unless
measured separately. Superseded copy,
fingerprint, and whole-graph-key paths must be removed in the same unit, not kept
as alternate producers or renamed compatibility fallbacks.

## Versions and Lifetime

Validated selected pages are joined as owned typed DTOs under the existing row, page, revision, scope, ordinal, and selected-row limits. Raw capture depth/visit bounds apply at each untrusted page boundary; joining already-owned pages does not reapply that raw-graph budget. A raw capture failure remains a body-free `invalid_response` outcome, while an ordinal/revision/identity mismatch remains a selection-gap outcome. Rich multi-page rows are therefore legal when each page independently qualifies; no limit or worker increase is implied.

Core **revision** identifies the selected history state. Local **generation**
orders semantic display publications, including live/Work changes at the same
history revision. The local **owner identity** invalidates callbacks on cancel,
Thread changes, reconnect, and revoke. One accepted ownership boundary owns that
identity. An additional capability/epoch security framework with the same meaning
is unnecessary; private code still needs the actual cancellation identity.

A lease is an actual read job, not a version clock. A receipt is an exact source
observation or transfer fact, not a version clock. A physical page is part of its
owned selected read, not a new independent read authority. Preserve the existing
bounds: 200 rows per page, eight markers, two leases, eight bounded pages for a
1,600-row selected cut, original dispatch-start budget, depth 64 and 65,536 input
visits. A logical selected dispatch is charged once; its independent successor is
charged separately. Physical RPC counts are reported separately, never hidden.

Selected coverage means the accepted contiguous range plus exact public attempt
refs at one revision/current owner. It is not the whole Thread. The first 200
rows of a 201/1,600-row successor remain private input until all required pages
qualify. Revoke, cancel, a newer local owner, a gap, or a mixed revision prevents
the entire candidate swap. The previous current display remains unchanged.

## Bound Failure and Minimal Diagnostics

A 65,536-visit/depth-64 exception alone is not a user-facing recovery policy.
External malformed/over-bound input must fail before candidate buckets, total,
revision, or cursor are installed. With an accepted same-Thread cut, retain that
cut and expose a bounded reason; without one, expose an explicit initial-read
error rather than a successful empty conversation. A legitimate empty history
and a rejected publication are different outcomes.

The existing publication/read state carries a small reason code, local generation,
Core revision, owner identity/epoch and time where needed. Reasons include invalid
input/bound, stale owner/revision, incomplete selection and unavailable body. Do
not record body text, prompts, secrets or private conversation payloads. Do not
add an RPC, an unlimited registry, or a tracing framework. Qualification belongs
before a swap, not in a catch-all that hides a partly installed cursor.

## Alternatives Not Adopted

- **Remove every owner identity because modules are private.** Private visibility
  does not stop a callback from a cancelled connection arriving after the same
  Thread is reopened. The ABA, same-ref revoke, copied/replaced lease and cancelled
  page cases require the actual local lifetime, not a new security framework.
- **Collapse revision, generation and owner into one number.** A live delta can
  change the display without changing Core revision; reconnect can invalidate an
  old callback at that same revision. Accepted R2 followed by point R1 must not
  pin a fresh R1 successor. One number either loses these distinctions or hides
  the same extra state elsewhere.
- **Render arbitrary saved data whenever live ownership is uncertain.** A saved
  response from another Thread or an old/deleted selected path is not current
  canonical data. Render known complete current canonical bodies independently;
  do not resurrect foreign, deleted, old-revision, or revoked content.
- **Copy/fingerprint every internal object to prevent internal forgery.** This
  repeatedly normalizes owned data, duplicates graph allocation and serializes
  the entire selected cut. It contributed to the measured local hot path and the
  failed cross-platform performance controls, but is not asserted as the sole
  cause of every OS difference. Move mutation/getter isolation to the typed input constructor and share internal
  immutable representation, while retaining real source/lifetime checks.
- **Use a frozen-object exception, cached plan, repaint, forced ready/complete,
  text matching, deduplication, larger limits or longer timeouts.** None supplies
  missing source/body/currentness evidence. They can hide mixed revisions, an
  independent equal-text execution, wrong-attempt retirement, or an over-bound
  partially installed display.
- **Add one production exception for each historical failure.** The historical
  causes stay as regression evidence, but production behavior is explained by
  canonical body authority, live ownership, and atomic publication. Remove an
  obsolete path rather than layering another alternate permission source.
- **Defer known performance/boundary defects to a future issue to meet a date.**
  Current three-OS timeout and incomplete failure recovery are part of this unit.
  Dates never qualify red source or authorize weaker original assertions.

## Source and Regression Links

- Input validation/ownership: `web/data/src/operations.ts`,
  `web/data/src/store.ts`, `web/data/src/public-response-refs.ts`;
  `web/data/test/operations.test.ts`, `web/ui-core/test/window-provenance-capture.test.ts`.
- Accepted ownership/atomic swap: `web/ui-core/src/accepted-view.ts`,
  `web/ui-core/src/window.ts`; `web/ui-core/test/accepted-view.test.ts`,
  `web/ui-core/test/window-accepted.test.ts`, `web/ui-core/test/pending-invalidation.test.ts`.
- Current canonical/body and overlay composition: `web/ui-core/src/conversation-input.ts`,
  `web/ui-core/src/conversation-display-plan.ts`, `web/ui-core/src/assistant-ownership.ts`,
  `web/data/src/handoff.ts`; `web/ui-core/test/owner-isolation.test.ts`,
  `web/designs/console/test/conversation-public-entry.test.tsx`.
- Selected pages and exact source negatives: `web/data/src/terminal-read.ts`;
  `web/data/test/terminal-read.test.ts`,
  `web/designs/console/test/terminal-receipt-selected-cut.test.tsx`,
  `web/designs/console/test/terminal-receipt-ninth-source.test.tsx`.
- Original performance controls: `web/ui-core/test/window-measure.test.ts`,
  `web/ui-core/test/window.test.ts`, `web/ui-core/test/reader-state.test.ts`.
- Reported incident evidence is separate from synthetic tests, source review, CI,
  landing, deployment and actual user confirmation. No private owner/DB access or
  deployment permission follows from a green source test.

## Ownership And Validation Contract

The accepted source lease is producer-owned. Typed `updateRecord` transitions
increment source revision only for semantic source changes; same-content
confirming repeats and transfer bookkeeping preserve a captured display lease.
Confirming-to-failed revokes a prior lease, while an already-failed readable source
remains readable. Repeated failure and same-content updates are true no-ops.

Conversation identity uses one captured Work source/facts descriptor plus the typed
own-send extension. Equality compares named identity fields and the stable Work
source. Accepted successor staging retains the full `AssistantOwnership` relation,
including mode, proof revision, receipt revision, item keys, and selected refs.

Accepted publication uses the View capability and currentness/disposal guards as
one lifetime identity. History joins use `MAX_HISTORY_ROWS` for both admission and
joined-output checks; raw page capture remains independently bounded. Visual
window diagnostics remain a separate body-free UI concern and are not changed by
this unit.

## Composer Send Ownership

The composer owns a draft generation until the send reservation is accepted. The
model commits acceptance through one typed pending-to-accepted transition matching
operation, Thread, and scope; failure, retry, Stop, navigation, and a newer draft
retain the current owner. The existing send acceptance regression remains the
producer boundary for clear-on-accept and draft retention.

## Handoff Record Transition Contract

Handoff source identity compares all own record keys shallowly; the `transferred`
key is the sole typed bookkeeping exception. An unchanged source returns the
canonical previous record, a source change advances the source revision, and a
bookkeeping-only transfer changes only the transferred field without revocation.
Canonical staging and observer publication consume the returned held record.

## Notification Facts Label Boundary

Notification labels use only admitted public `kind`, time, and notification
facts. Missing facts use an honest unavailable-details label; body text is never
used to infer a notification. This patch adds no new surface, RPC, private fact,
style, or fallback.

## Notification Timestamp Decision

The missing-facts notification label is a factual unavailable-details statement,
not a content-summary inference. The existing public `created_at` fact remains in
the display context and, for notification facts without a typed summary, is
rendered as a factual timestamp suffix in the notification label and ARIA context.
Missing time stays the literal facts-only label. Alternatives were not chosen: a
global formatter change would widen every row consumer, while dropping the time
fact would regress accessibility and visible context. The regression covers time
present/absent, body non-inference, and rendered text/ARIA retention.

## Studio 18 Memory Card Boundary

`status --memory` is a bounded owner read. Cache entries whose public response
reports an unavailable owner are localized as `Not reported` at the card boundary;
that card-level absence does not become whole-owner unavailable, and other cache
entries remain renderable. Unsupported operations, malformed responses, and
transport disconnects remain distinct read outcomes through the existing typed
operation/error path. No response body, private owner data, guessed version, RPC,
or compatibility fallback is introduced. Owner application version remains
unreported unless an existing public hello/status route supplies it; protocol and
bridge versions remain separate facts.
