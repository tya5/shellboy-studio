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

The captured scope is the current `ThreadHandle.threadId` passed to
`captureConversationInput`; it is not a fabricated owner-instance JSON tuple.
The captured identity retains the accepted rows/revision, handoff-record array,
Work source object, scope string, and currentness callback. Attempt identity is
only an association within that captured scope. A changed ThreadHandle, thread,
live epoch, reader epoch, capability, or accepted generation invalidates the
candidate before publication.

`createBoundWindow` binds the current ThreadHandle and typed semantic input
before reads are admitted. The production and controlled factories use the same
public handle/read/capture methods; history-only callers remain explicitly
separate and do not manufacture live ownership facts. Currentness is checked
against the captured handle/thread/epoch/capability values, not against a
presentation container or a fallback registry.

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
scope, multiplicity, scroll, cancellation, and ABA suites. Work-source and
picker/session ABA remain covered by the registered `branch-compare.test.ts`
controls (`owner ABA during initial publish does not revive old invocation` and
the inventory B/ABA cases), plus the console smoke tests `with the capability:
picker, preview, then Move; a refusal shows the owner's words` and the model
picker warning case. Those controls validate public owner/session rebinding;
this document does not claim a universal Work-source lifetime guarantee.

## Browser Witness

The current handoff browser fixture is a public synthetic witness for DOM
ordering, accepted-generation/currentness, scroll-consumption ownership,
selection/geometry stability, obsolete-effect rejection, and public projection
mapping. It does not prove a real owner transport, a public typed producer, or
full device behavior. Its runner records the assertion mapping and unsupported
claims explicitly; screenshots are supporting artifacts, not acceptance proof.


## Known Boundary

The later Core #308 one-boundary append direction is recorded as feasibility
guidance only; it is not implemented here and does not authorize a new ordering
architecture or permission. The current Studio contract is canonical-prefix-first
with captured unmatched live/Work suffix.

The public binding is ThreadHandle plus thread identity, owner lifetime, reader
epoch, capability, and accepted generation. Factory construction binds these
values before reads are admitted; a candidate is accepted only when the captured
values still identify the current handle and scope. This contract does not claim
universal immutability outside the published containers, nor does it claim a
stronger owner lifetime guarantee than the actual epoch/cancellation checks.
