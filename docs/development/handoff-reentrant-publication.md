# Reentrant Ledger Publication

| Condition | Action | Bound / authority |
| --- | --- | --- |
| ordinary mutation | publish latest held record references | synchronous |
| mutation during notification | mark dirty; outer publisher captures latest held state | no recursion/task |
| exact end during stage notification | trailing empty ledger publication | original end guards unchanged |
| discard during notification | publish new lifetime's current empty state | old capture invalid |
| continuously mutating observer | stop after eight passes, invalidate captures and expose overflow | fail closed; no queued loop |

The former post-notification qualification-failure hypothesis is withdrawn.
Measured actual App execution passed all token/source/ref/cap/generation and O
capture checks; exact end removed private held state. The previous publish guard
then dropped the nested empty notification, leaving a ghost public record.

No disposal task exists: publication is synchronous and always snapshots current
held state; no captured old-lifetime snapshot is queued. Pathological observers
may leave a stale public snapshot after the bound, but cannot retain valid capture
authority. A later explicit mutation can publish again. This does not replenish
reads, clear overflow, reclaim proof slots or establish future freshness.
