# Conversation Publication v27

This is the forward contract for the Studio #27 recovery line. It starts from
qualified main `0b05ba11568e5bda7c0c36140ed7933a7e3eb606` and does not carry the
unqualified S6/label work from the archived `896db3e` line.

## One Accepted Update

The public canonical response producer supplies one authenticated association
with the saved response: `attempt_id`, `turn_id`, selected response references
`(node_id, ordinal, kind)`, thread/scope, source revision, complete body/item
proof, presentation container, owner/capability lifetime, and the current
accepted generation. The existing `AttemptReadyProof` and
`Window.acceptHandoff` boundary consumes this bundle. It must atomically append
the canonical rows, retire the same-identity live overlay, and publish one
current display plan. `messageId` remains the analogous identity for own-send
acceptance.

A plain history row has node/ordinal/body facts but does not authenticate the
retained live attempt or its presentation container. The missing fields are
therefore a Core/public producer contract gap, not a renderer fallback. The
Core author lane must add the association to the existing public canonical
history response; no private RPC, database read, installed migration, or
second lookup registry is permitted.

## Removed Target Machinery

After the producer contract is available and the existing proof boundary is
adapted, the forward line removes the separate handoff lookup, confirmation
stage, read-budget cap, and retry scheduler. It does not remove real transport
failure or incomplete/unauthenticated response handling. UI consumes the one
authoritative typed acceptance/retirement state; it does not infer state from
text, hide the body, force readiness, or imperatively replace DOM nodes.

## Required Negatives

Keep the existing controls for wrong attempt/turn, wrong scope, wrong revision,
missing/partial response refs, incomplete body, stale generation, owner/lifetime
change, same-proof no-op, duplicate refs, interleaved old/new live attempts,
manual scroll/tail-follow, and own-send pending ownership. Add the producer
contract only in a separate Core unit; do not mix it with Core #301 or the
archived Studio S6/label qualification.


## Attempt association boundary (Studio follow-on)

Core c591 exposes only the optional `NodeProvenance.attempt_id` association; existing provenance supplies the other identity fields. Studio may retain this field as a strict optional lowercase canonical UUID (8-4-4-4-12 hex; no version/variant restriction) on `HistoryItem` and `history.get`/owned `history.window` decoding. Missing or producer-absent/ambiguous association remains unknown; malformed values are rejected, while unrelated provenance extras remain under the existing contract. This association alone does not prove complete body, current capability, accepted generation, receipt, live retirement, readiness, or permission to remove history readback. Those are separate source contracts and must not be inferred or implemented by this follow-on unit.
