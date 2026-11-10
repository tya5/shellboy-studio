# Qualified Legacy Bundle - Stage 1

Scope: CURRENT representation GC only. No new reads, admission, cohort refill,
Window presence transaction, owner restart, or future freshness guarantee.

| Source condition | Current reference | Representation proofs | Structural receipts |
| --- | --- | --- | --- |
| original token/scope invalid | false | no old writes | never transferred to new lifetime |
| history/live/work/pending identity or content changed | false until sync | capture all sources again with ORIGINAL token | preserve |
| work absent/loading/stale/error/paged | qualified captured bundle | keep | preserve |
| any work attempt association missing | qualified captured bundle | keep all | preserve |
| complete work plus original ledger prove current absence | qualified captured bundle | remove absent attempts only | preserve |
| ninth structural receipt | existing eight stay | reject retirement, publish independent rows | cap remains eight |
| notification reentry | reject old result | no overwrite of new ref | no stale release |

The public resource/page/nested types are mutable. Producers replace resources,
but identity alone is not assumed: a bounded-source content fingerprint detects
in-place nested changes. Every consumed resource is captured and checked before
commit and after notifications. Local projectionGeneration is not an owner cursor.
The class creates no subscriptions or tasks; D owns its existing reactive effect
and accepted-view subscription and disposes both with this view. Reads in the D
effect establish dependencies; it must consume ref.work rather than handle.work.

structuralTerminalReceipts are exact successful-transfer receipt authority, not
current representation membership. Consumers MUST apply their same-ref scope/
attempt suppression to BOTH projected ref.live and projected ref.work facts.
Representation-proof GC must never remove this authority or resurrect old body.
Do not read receipts from an independent raw ledger or stale reference.

The bounded receipt store is intentionally NOT garbage collected without an end/
freshness contract. Therefore this checkpoint may collect representation proofs
but does not fix ninth durable retirement or all user warnings. Independent saved
rows still publish on rejection. No unbounded seen set or recent-eight freshness
claim. The cross-RPC barrier is on HOLD; fab0 remains unadopted.

Tests include actual Store/O qualification plus public-handle adapter controls for
work completeness, in-place mutation and capacity. Adapter tests are not evidence
of public persistence producer authority. D same-bundle integration remains a
separate acceptance gate.
