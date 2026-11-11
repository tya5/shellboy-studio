# Local Receipt Capacity Explanation

HandoffRetryState gains unavailable/receipt_capacity/canRetry:false only after an
actual exact-terminal/valid-refs lookup was denied at the existing eighth-receipt
allocation guard, and all remaining unresolved attempts were blocked there in the
same valid scope/epoch/cancelled owner context. Mixed unresolved causes keep the
existing actionable reason. Per-resolver evidence set is bounded by the existing
held record bound, owns no public proof, and dies at resolver completion. Existing
receipt reuse is not blocked. Next independent resolver derives the reason afresh.
No map eviction, refill, read budget change or live/body deletion occurs.
D owns UI reason translation/confirming header. This is explanation only, not a
fix for duplicated live/canonical bodies or proof that the USER hit this cap.

## Fresh DOM Suppression Feasibility (Design Only)

| S6 condition | Existing public surface / gap | Decision |
| --- | --- | --- |
| Exact attempt/node association and fresh canonical ref | attemptPresentations is derived from staged owned proofs; cap-blocked lookup creates no such proof or presentation. Canonical node/turn alone does not prove the live attempt. | Cannot reuse current attemptPresentations for ninth association. |
| Complete nonempty final DOM membership and atomic suppression | Existing TerminalPersistedProof identifies persistence, not visible body; lookup refs alone do not supply final item membership. | New bounded lookup-association issuer + final presentation CAS seam would be required. |
| Revoke/unmount/revision/route ABA invalidation | Reader ref can expire; no existing non-durable association token is emitted for the cap branch. | A caller object or raw node ID join is not authority; fail closed. |
| No receipt GC/cap bypass | New proof must not allocate/evict a durable receipt or retire existing cohort partially. | Current source cannot implement this by reusing a terminal receipt. |
| Same proof bounds, lifetime and shutdown | A transient association would need an explicitly shared bound with existing held slots and original owner token; no extra map or timer allowed. | Contract incomplete; no production suppression authorized. |

Conclusion: existing surfaces are insufficient for safe ninth live suppression.
A separately reviewed issuer-to-presentation scoped association capability would
be necessary; this child implements NONE of it. Preserve explicit backpressure.
