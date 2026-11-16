# Conversation Publication v27

This document is the current Studio #27 contract for the accepted conversation
window. It describes the public source boundary, not a renderer workaround or a
private owner/database integration.

## Current Scope

One accepted update is an immutable cut containing the selected history rows,
source revision, scope JSON, owner/capability lifetime, accepted generation,
canonical projection, live projection, presentation containers, and local-send
ownership. The cut is admitted only when the Window's current ThreadHandle,
live lifetime, capability, reader epoch, and semantic input are current.

The publication authority is `ConversationWindow.commitAccepted`. It qualifies
the whole candidate before `AcceptedView.publish`; the accepted callback only
performs retirement inside that same accepted transaction. There is no second
post-publication binding guard, reconcile pass, fallback registry, or callback
that silently skips retirement after saved content is visible.

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

## Scope And Lifetime

The scope JSON is exactly `[owner.instance_id, entry.id, entry.live.lifetime]`.
It is the issuer-owned identity for live and saved association. Entry identity
and attempt identity are not interchangeable, and a saved attempt association
must remain in that exact scope. Presentation container names are not authority. A changed owner,
ThreadHandle, live lifetime, reader epoch, capability, or accepted generation
invalidates the candidate before publication.

The `Window` source uses one typed binding contract. Production construction
binds the current ThreadHandle and semantic input before reads are admitted.
History-only Window callers use an explicit typed history binding; live-capable
callers use the ThreadHandle binding. There is no unbound current-commit path
and no optional runtime fallback that manufactures ownership facts.

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
scope, multiplicity, scroll, cancellation, and ABA suites.

## Browser Witness

The current handoff browser fixture is a public synthetic witness for DOM
ordering, accepted-generation/currentness, scroll-consumption ownership,
selection/geometry stability, obsolete-effect rejection, and public projection
mapping. It does not prove a real owner transport, a public typed producer, or
full device behavior. Its runner records the assertion mapping and unsupported
claims explicitly; screenshots are supporting artifacts, not acceptance proof.
