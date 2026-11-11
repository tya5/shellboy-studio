# Assistant Membership Investigation

USER v0.2.4 reports a nonempty answer disappearing again. Legacy8f9 repaired one
reentrant producer publication only; neither general disappearance nor empty tail
is closed. No actual USER node identity or causal trace is established.

| Typed Source | Required Membership | Current Source Boundary |
| --- | --- | --- |
| qualified live text with characters | readable assistant | live text materializes as text; namespace remains live |
| qualified live text with zero characters | generation presence, not header-only answer | Message currently mounts name/avatar/time anyway |
| saved explicit typed zero-length assistant text | distinct from missing/unavailable/ordinary-empty | CASE conversation renders header-only Message |
| saved nonempty text | readable assistant under fresh accepted ref | current=false empties all canonical items and sequence |
| ordinaryEmpty assistant node | explicit existing empty-history statement | CASE ordinaryEmpty; not a typed empty answer |
| unknown/unavailable body | existing honest unavailable Work policy | must not be hidden as empty text |
| terminal persisted receipt | live off, pending/settled receipt presence | receipt is not body authority and cannot revive live text |
| revoked owner/scope/path | no unauthorized public assistant | no old-ref cache or current=true fallback permitted |

Three separate source paths must not be conflated:
1. Empty typed/live Message still mounts header; creates an answer-shaped row with
   no answer content. Any membership repair must consume structured source facts,
   not globally hide every empty body, min-height, timeout or force-scroll.
2. Window ordinary refresh reads without revoking acceptedView. Revocation occurs
   on reset after path/cursor invalidation or disposal. reset deliberately clears
   buckets/revision and publishes a replacement before recovery. Treat this as a
   qualified path loss, not authority to preserve old rows. A controlled ordinary
   append/terminal held read must first demonstrate a needless empty publication
   before changing this producer.
3. Terminal persisted proof turns live off before saved readable body exists;
   receipt presence remains a Work fact. New answer absence here does not prove
   that an already-loaded unrelated answer was removed.

ONE membership result must eventually bind final CASE item membership, structural
presence and render keys to the same accepted snapshot. Namespace/key transfer
cannot be inferred by matching body/time or guessing a saved node. Existing public
attempt/receipt association and producer qualification are the only candidates.

## Typed Empty Presentation Repair

Composer and fresh own-send placement are separately frozen earlier commits.
The current repair derives one AssistantTextMembership map from the already
qualified final CASE items. It does not change CASE, public data or read authority.
Only kind=text AND exact text=="" is handled specially (no trim/normalization):
- Live text: existing Writing presence in the same item wrapper, no Message header.
- Saved explicit textComplete=true: no message membership/wrapper.
- Saved partial or unknown completeness: existing honest text-unavailable content,
  no fabricated generating status and no header-only answer.
- Every nonempty text, user/summary, ordinaryEmpty, unknown and unavailable item
  follows the prior path unchanged.

A single real Window accepted-read consumer control records empty live -> live
body -> terminal live-off -> new saved body + empty complete/partial -> refresh ->
reader disposal. The prior nonempty assistant DOM object stays identical through
qualified frames; live presence/body retain the original item wrapper. The saved
body remains stable across refresh and revoked refs mount no public answer.
Live and saved answer wrappers are NOT merged across namespaces without a public
identity association; no cross-domain same-DOM guarantee is claimed.

Original source fails the same control at empty live (two Message rows rather than
one existing answer plus Writing presence). Fixed source passes the three existing
files/75 controls including terminal-held/read cancellation and Window invariants.
This closes an unnecessary typed empty header source branch only. USER's nonempty
answer disappearance remains unexplained; the normal qualified refresh and held
terminal controls do not reproduce that reported disappearance. No producer reset
or current guard is loosened, no stale cache or live retention is added.
