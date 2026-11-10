# Own Send Bounded Ledger

Leader decision: one inflight/uncertain operation, at most eight local entries
including the reserved inflight entry, and 4 MiB aggregate submitted UTF-8 text.
Existing per-message owner limits are unchanged. No timers, eviction, body joins,
background resubmission or extra execution queue.

| Input / Type | Branch And Ownership | Local Presentation | Named Control |
| --- | --- | --- | --- |
| Submit, connected current scope | Reserve entry and UTF-8 bytes before dispatch | Sending text, draft retained until ack | actual Composer Enter held request |
| Entry/byte capacity unavailable | Reject without dispatch or mutation identity replacement | Keep draft and all prior entries; capacity reason | ledger entry/UTF-8 backpressure |
| Public MessageAccepted exact Thread | Move reserved entry to ACKED ledger; release inflight immediately | Preserve accepted text; next send enabled | consecutive acknowledgements before saved arrival |
| Failed or uncertain acceptance | Keep original inflight operation/text/reservation | Original-operation retry only | failed retry identity; uncertain Enter |
| Same current accepted saved ref, exact node ID | Remove matching ACKED entry and reclaim capacity in same display projection | Saved row only | saved reorder, wrong ID, current-ref guard |
| Navigation / owner / scope invalidation | Invalidate late acknowledgements, release local ledger | No old-scope local entries | navigation late acknowledgement |
| Input while old request awaits ack | Draft generation changes | Never clear new draft on old ack | new draft generation |

An acknowledged entry is not saved history authority. message_id/thread_id are
validated public receipt fields; the accepted saved ref remains the authority for
replacement. The ledger is owned by AppModel and disposed with it. Eight/4 MiB
bounds include reservations, so accepted entries cannot be dropped after dispatch.
