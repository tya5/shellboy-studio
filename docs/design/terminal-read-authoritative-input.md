# Terminal Read Authoritative Input

This note records one bounded public fact boundary for the canonical terminal
read -> atomic acceptance path. It is an incremental design decision, not a
claim that the whole #27 behavior is complete or that every canonical path
requires this read.

## Observable Branches

The receipt-only synthetic branch in
`web/ui-core/test/terminal-presence-read.test.ts` starts with Store receipt
admission, not proven canonical ownership. Its accepted window contains only
the saved `tool` row. One `history.window` read is issued; after that read the
accepted window contains `tool` and `answer`, terminal presence is cleared, and
the accepted generation advances. The test asserts the actual receipt refs (answer-only in this fixture),
read count, rows, and current transition facts; tool-call body facts are
asserted from History rows, not invented as receipt refs. It does not label the
initial state canonical ownership.

A separate ready branch first proves `assistantOwnership.mode === "canonical"`,
its actual proof refs, retired attempt, empty handoff, settled first lease, and
current qualification. A second `prepareBoundReadyRead` then returns the
actual typed `{ phase: "unavailable", reason: "cancelled" }` outcome, issues
zero additional reads, and leaves retirement/current qualification unchanged.
This is evidence that the already-complete branch suppresses redundant
readback; it does not prove that the receipt-only branch is canonical.

| Fact | Already in the public bundle | Still missing until the bounded read/commit |
| --- | --- | --- |
| receipt admission | scope, attempt, turn, node refs, receipt | canonical ownership mode and complete owner proof |
| ownership association | record/presentation identity when present | row/body agreement for every selected ref |
| terminal selection | node IDs and ordinal/kind refs | selected revision and complete body rows |
| read authority | captured qualification/owner epoch | current capability, accepted generation, current read result |
| confirmation | terminal receipt and pending presence | successful `history.window` result and atomic publication commit |

## Decision

For a missing-body receipt-admitted branch, use the existing
`TerminalPersistedProof` plus the bounded selected `history.window` result and
existing current qualification/capability/generation checks as the minimum
input to the readback/acceptance decision. Do not treat an optional attempt ID
as a complete proof: it cannot prove the body, refs, selected revision,
capability/epoch, generation, or receipt.

The complete canonical-owner branch is distinct: it may already have enough
facts to reject a redundant read, as the contrast test demonstrates. The next
structural unit must be selected from this difference rather than by deleting
lookups broadly. Preview and normal readback remain visible until their own
admission contract succeeds.

No new RPC, lookup, cache, registry, retry path, or forced-ready state is
introduced by this decision. Existing missing, partial, deferred, invalid
scope, revoked, and reentrant negative branches remain authoritative.
