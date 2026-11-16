# Conversation Publication v27

This document is the current Studio #27 contract for the accepted conversation
window. It describes the public source boundary, not a renderer workaround or a
private owner/database integration.

## Current Scope

One accepted update is an immutable cut whose canonical saved projection is
ordered first, followed by unmatched live and Work facts in their captured order.
When a saved assistant replaces a live attempt, its complete canonical items
remain at the saved ordinal position; the next canonical user follows them, and
only unmatched live facts remain as the suffix. Multiplicity, canonical ordinals,
source identity, and unrelated relative order are preserved.

After the staged semantic lease and pure candidate checks qualify, the selected
rows, projection, geometry, and related state are installed by the single
successful commit callback; only then does that callback retire the matching live
record and notify subscribers. `ConversationWindow.commitAccepted` performs the
whole candidate qualification before `AcceptedView.publish`, with the callback
handling state installation and matching retirement as one accepted transition.
There is no second post-publication binding guard, reconcile pass, fallback
registry, or callback that silently skips retirement after saved content is
visible.

A stale owner/thread/lifetime/capability/reader candidate is rejected as a
whole. It must not publish saved rows while retaining a matching live overlay.
Rejected candidates preserve the prior accepted ref and live identity.

## Window Coverage Invariant

The canonical saved projection is authoritative for every accepted window.
Unsaved live/Work facts are appended only when the accepted range is tail-complete
(`total === 0` or `range.last === total - 1`); an older/non-tail window publishes
only its canonical saved prefix and never places an unsaved suffix at that
window's middle or end. The normal following reader refills the tail before its
settled publication. This is one coverage predicate in the existing
model/window projection path, not a frontend anchor, fallback registry, or
duplicated ordering state.

## Body And Live Semantics

- Saved rows retain node identity, item identity, source revision, and body
  completeness. A saved node is not reused for another attempt; a new attempt
  receives a new saved node identity.
- A matching attempt is retired only after the accepted saved row carries the
  same canonical attempt association and the accepted revision/body cut is
  current.
- Foreign live attempts remain visible and retain strict identity across the
  matching retirement. A legitimate handoff status transition may replace the
  record object; tests capture the identity after that transition and then use
  strict identity for later updates.
- Incomplete or unavailable bodies retain preview/unavailable behavior. A body
  read is an ordinary explicit `history.get` request and never a full-body veto
  on the accepted publication.
- Body reads remain bounded by the existing page/read budget and current
  handle, route, reader, capability, and cancellation checks.

Tool projection uses first qualified association wins: the first source with the exact scoped execution/call association owns the selected tool row; later same-association sources may contribute only the documented compression metadata and never replace the owner's body. Missing, conflicting, foreign-scope, and live-tool associations remain separate unresolved facts.

## Scope And Lifetime

The semantic `scope` is obtained from the model's `ownMutationScope()`.
Depending on the current own-send state it is an own-mutation scope or the
literal history scope; it is not necessarily `ThreadHandle.threadId`. The
captured identity separately retains the accepted rows/revision, handoff-record
array, Work source object, scope string, ThreadHandle/thread identity, live
and reader epochs, capability, and currentness callback. Attempt identity is
only an association within the captured scope. A changed handle, thread, epoch,
reader, capability, or accepted generation invalidates the candidate before
publication.

`createBoundWindow` is a test fixture helper only. Production `AppModel`
construction creates a `ConversationWindow`; its constructor can admit the
initial read before the model later binds the current handle and semantic input.
The production contract therefore relies on the later captured currentness and
publication guards, not on a factory-before-read guarantee. History-only callers
remain separate and do not manufacture live ownership facts.

## Ordinary Loading And Scroll

`loadBody` uses the ordinary `history.get` path and publishes only when its
captured handle, route, reader, cancellation token, and capability remain
current. Transport/page bounds and general cache bounds remain separate from
publication semantics; no retired handoff read budget is imposed on ordinary
body loading. `changed()` follows the normal Window refresh path; tests answer
all required synthetic RPC commands except one deliberately held old request.
They must not convert a retry loop or a forced tail jump into evidence of an
accepted publication.

Manual scroll and tail-follow remain separate reader state. Accepted rows,
DOM identity, selection, anchor, geometry, and pending scroll consumption are
validated independently. An obsolete scroll effect consumes no request and
performs no DOM write.

## Required Assertions

The minimum discriminating scenarios are:

1. matching update: a fresh saved node with exact attempt provenance is accepted
   before matching live retirement; assert saved `1`, live `0`, and the current
   accepted ref;
2. different attempt: a foreign live record remains and retains strict identity
   after the matching update;
3. missing attempt: absent/malformed provenance does not authorize retirement;
4. large excerpt: a body over 16 KiB uses the ordinary button and typed
   `history.get` path, without a full-body veto.

Lifecycle, scope, multiplicity, scroll, cancellation, ABA, and own-send cases
remain additional registered negatives and are not replaced by these four cases.

These are minimum controls, not a replacement for the existing lifecycle,
scope, multiplicity, scroll, cancellation, and ABA suites. The actual retained
public controls are:

- Work-source normalization and substitution rejection in
  `web/ui-core/test/conversation-items.test.ts` (`issues supported live activity
  CASE` and the cloned-source `scopeIssuedWorkFacts` rejection), which verifies
  the captured source object rather than a generic owner ABA model.
- Model picker/session owner ABA in `web/ui-core/test/model.test.ts` (`rejects a
  held model-picker save after owner/session ABA without dispatch`), alongside
  the existing `lists models and sends only this Thread's model settings` and
  `does not write thread settings without the capability` controls.
- Published semantic currentness remains separately covered by
  `accepted-window-live-retirement.test.ts`, including `foreign current handle
  does not retire the old live identity` and `semantic callback rebind rejection
  preserves accepted ref/rows/live identity`.

These mappings are component-specific; BranchCompare and Thread REPARENT smoke
controls are not used as evidence for Work-source substitution or picker-save
ownership.

## Browser Witness

The current handoff browser fixture is a public synthetic witness for DOM
ordering, accepted-generation/currentness, scroll-consumption ownership,
selection/geometry stability, obsolete-effect rejection, and public projection
mapping. It does not prove a real owner transport, a public typed producer, or
full device behavior. Its runner records the assertion mapping and unsupported
claims explicitly; screenshots are supporting artifacts, not acceptance proof.


## Adjacent Scope Boundaries

The current #27 publication layer preserves the canonical saved prefix and
unmatched unsaved suffix; #29 own-send stable-position behavior remains a
separate next unit, while existing own-send tests retain multiplicity, scope,
currentness, cancellation, and rejection controls. Existing conversation-item
projection tests cover interleaved tool-call/result grouping by explicit
execution association; #24 is not closed by this source fact alone. #30 remains
non-display pending scope.

## Known Boundary

The later Core #308 one-boundary append direction is recorded as feasibility
guidance only; it is not implemented here and does not authorize a new ordering
architecture or permission. The current Studio contract is canonical-prefix-first
with captured unmatched live/Work suffix.

The public binding uses the captured ThreadHandle/thread identity, owner/live
and reader epochs, capability, accepted generation, and the model's separate
scope value. Semantic reading-position preservation is not supplied by the
removed unreferenced summary-anchor helper; remaining Window anchor/geometry
behavior is independent. A candidate is accepted only when those captured values still
identify the current handle and scope. This contract does not claim universal
immutability outside the published containers, nor a stronger owner lifetime
guarantee than the actual epoch/cancellation checks.
