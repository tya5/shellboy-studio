# Presentation Ownership: Own Submission And Assistant

USER reports concurrent Writing and final content in trial acc4d3c. The observed
screen has not been assigned to an origin; own ACK publication is one independently
verified source defect, not proof of USER same-cause or assistant resolution.

| Origin / Frame | Exact Identity / Key | Representation / Switch |
| --- | --- | --- |
| own reservation | scope + original operationId; no accepted message ID yet | one pending row, sending phase |
| own successful ACK | original operationId, same scope + accepted message_id | accepted ledger insertion + pending removal + idle now batch-published |
| own canonical arrival | current accepted raw user node with exact message_id; full CASE items | ONE ownSendPresentation handles canonical visibility/slot replacement; Q1 full-text retirement separate |
| assistant streaming | public attemptId + handoff key; record has no exact saved node/turn yet | live text retained, no body/time match allowed |
| assistant saved overlap before proof | saved node/item identities; saved turn if supplied | no inferred relation to live attempt; remains unresolved without exact association |
| assistant ready proof | exact attempt, turn, revision, node refs and owned transfer | Window retirement + saved rows in same accepted commit; legacy receipt filter likewise |
| assistant terminal persisted | exact attempt, optional turn, saved node refs | existing live-off, CLIENT missing-body presence until canonical body accounted |
| owner/scope/path invalidation | accepted ref current=false | do not retain old label, body or inferred counterpart |

## Own ACK Source Repair

Previously accepted insertion synchronously notified subscribers while pending was
still the SAME operation in sending state. ownMutationRows concatenates these
ledgers, so ONE presentation could receive duplicate originals. Three signal
updates now form one batch, before synchronous subscribers may reserve a different
operation or invalidate route/owner. This is not body deduplication or a guard
bypass. Full ACK thread validation, operation qualification, error/uncertain pending
and invalid receipt paths are unchanged. No catch/retry or allocation-error policy
is added; construction failure is not claimed as a tested recoverable scenario.

The earlier documented transient eight-accepted + one-pending SAME-op overlap is
no longer intentionally observable on success. Accepted<=8, active pending<=1 and
original UTF8 byte budget remain separate, unchanged admission limits. A valid
subsequent operation may publish its own pending entry after the complete commit;
that is NOT a duplicate of the accepted original. No silent row/capacity increase.

Evidence: original existing-model synchronous frame control fails on same-op
accepted+pending coexistence. Fixed program includes new reservation/route/owner
notification reentry controls and existing actual App Window/Legacy pre-ACK,
saved-before-ACK, accepted-only, canonical arrival and refresh identity controls.

## Remaining Assistant Gap

A streaming HandoffRecord can contain attemptId/key/text while nodeId/proof/
readyAttempt/terminalPersisted are absent. A canonical assistant node alone is not
an exact link to that attempt. Closing that overlap requires an existing public
exact association (attempt+turn+node under qualified refs), not a title/body/time
join or blanket live suppression. No new fetch/private lookup is introduced here.
Ready records can also project an unknown Work fact before retirement filtering;
this branch is not declared fixed by the own-ACK batch. General USER concurrent
Writing/final display and earlier disappearance remain unaccepted until observed.

## Post-ACK Trial Observation

USER reports Writing plus final again after the own-ACK fix trial. This explicitly
rules out treating that source batch repair as USER symptom resolution. Which
origin is duplicated is still awaiting the leader's single clarification.

Composer's submitting ref stays true while its onSend Promise is pending and until
its await continuation/finally. Enter while held or synchronously in the same stack
as resolve is suppressed BEFORE onSend/reservation callback; the next draft stays
unchanged. After the continuation it can submit. This bounded JavaScript scheduling
observation does not establish a measured delay or explain USER's blocked third
send. Current capacity display changes are not installed in the reported trial.
The added finite control records both blocked stages and the successful later stage.

Assistant overlap remains a distinct gap: projectOwnedHandoffFacts converts a
record with nodeId/proof/transferred/ready into kind=unknown rather than emitting
no preview fact. SavedWindowContent independently appends these facts to canonical
rows, and only terminalPersistedAttempts or retiredAttempts remove them. Whether
an owned ready record and canonical row actually coexist under a current accepted
ref is not established by the own-ACK control. Exact node/proof is available in
some later states and must be validated against the same snapshot before any
switch. Streaming has only attemptId/key until such proof arrives; needed public
association is canonical exact attemptId+turnId+nodeId under a qualified snapshot,
not text/time or a new global join. No Core API change is claimed necessary for
ready states that already carry exact refs; absence in streaming is the separate
potential contract gap. No blanket live suppression is authorized by this note.

## Exact Trial Source And Terminal Outcomes

Trial f5d6ee3bb282f0f0490818cf6f7ed9f7a021dc5f store.ts Git blob
9d8ecd6cf6e6e1959f8f2c3eb35960a61c6bb073 / SHA256
306ccafe81e7238d4161993f1632661ccbe2c47166640226dce1686e096f92fe.
The earlier claim that response scope completeness blocks terminal receipt staging
was WRONG: the exact-terminal branch precedes that gate. No such patch was made.

| First Outcome | Source Condition / Observable Result | Existing UI |
| --- | --- | --- |
| owner/scope invalid | valid() false; no qualified receipt | existing owner/current invalidation; no stale counterpart permitted |
| lookup unavailable | lookup result error | lookup-failed; explicit retry policy |
| attempt identity absent | wrong Thread/attempt or no response_nodes array | unresolved, not proof of no saved counterpart |
| terminal with 1..64 valid public node IDs, owned receipt available | stage, transfer, qualified reader commit, release | receipt live-off and canonical/CLIENT body presence |
| terminal with >64/empty/invalid refs | no terminal proof | unresolved; existing negative controls |
| nonterminal / incomplete attribution | no terminal proof; strong full-body transfer gate remains | unresolved; no body exclusivity inferred |
| ninth distinct receipt in same lifetime | terminalReceipts.size>=8 before new staging | unresolved, canRetry=true, confirming row retained (misleading generic UI) |
| bounded read starts exhausted | takeRead false | budget-exhausted, explicit retry; distinct from receipt lifetime capacity |

Receipt map is bounded at eight across one entry lifetime, NOT eight current held
rows and NOT eight read starts. It is cleared on owner/cancel/close lifecycle paths;
canonical body visibility and held-slot end do not delete its entries. A retry
reconciles the existing read budget but cannot create receipt capacity.

A single actual App fixture admits eight sequential exact terminal receipts under
one unchanged public handoff scope. Each existing explicit retry is used at most
once per attempt; no new automatic refill is introduced. Attempts1..8 yield
receipts1..8, held0 and live0. Attempt9 yields receipts8, confirming held1 without
terminal proof, live1 plus independent canonical row, and unresolved/canRetry=true.
This reproduces a state shape similar to USER's report, not the real environment's
scope count or exact counterpart correlation. Original wrong live_end fixture type
and retry union access failures are author errors, not production RED evidence.

Safe proposed next seam: a closed receipt-capacity backpressure reason, retry
unavailable for that lifetime, and a confirming label instead of Writing. This
alone does NOT remove duplicate text or prove canonical transfer. No capacity
increase, receipt eviction, proof transplantation, cache or body/time join is
permitted without a separately adopted ownership contract. Production source is
unchanged while that seam is reviewed.

## Proposed Display Ownership, Separate From Receipt Retention

| Concern | Existing Authority / Limit | Fresh Display Requirement / Missing Contract |
| --- | --- | --- |
| persistent terminal receipt | owned terminalReceipts entry, max8 per lifetime | not increased or evicted by display matching |
| exact lookup association | owner-qualified terminal exactattempt and public node refs | at cap currently not published to consumer; existing pendingAttempts is created only after terminal branch, so ninth consumer cannot inspect it |
| canonical display | current accepted ref + FINAL visible member | must contain corresponding exact node/turn, not just raw DTO existence |
| retained owned live | exact original record object, scope and attempt | association must bind this original, not a later same-ID/key record |
| display suppression | not currently available for cap-blocked ninth | require same accepted decision and fresh association; do not release record or remove receipt as a side effect |
| canonical disappears or revision changes | prior ref cannot authorize a new display decision | recompute from new qualified data; no permanent suppressed-ID set |
| owner/scope/path loss | existing qualification revokes old read and association | no stale label/body/link or oldproof migration |
| ABA / stream re-entry | original-object + epoch/lifetime fences | older lookup must not hide a replacement preview, even if IDs match |
| GC | receipt map currently lifecycle-owned | visible body does not grant eviction; no implicit GC proposal |

One direct owner consultation is pending about reusing existing bounded
attemptPresentations for fresh display association or publishing a minimal typed
association before receipt-capacity denial. Either would be local data/presentation
contract work, not a new Core barrier by assumption. Required evidence would be
original record identity + current scope/epoch + exact attempt/optional turn and
node refs + current accepted canonical-visible member, with an explicit
invalidation/publication path. It is not satisfied by the retained preview text.
No such new source surface is implemented or accepted in this record yet.

### S6 Conditions 1-5: Feasibility Check (Not Implementation Approval)

| S6 Condition | Current Ninth-Receipt Surface | Decision |
| --- | --- | --- |
| 1 fresh accepted owner/scope/generation + exact association | canonical ref exists; ninth exact lookup refs are not exposed at cap | blocked without a new bounded current association surface |
| 2 complete nonempty same-membership atomic transfer/CAS | current canonical membership can be inspected, but no matching issued proof for original record at cap | not implemented; terminal refs alone cannot authorize text accounting |
| 3 unmount/revision/revoke/ABA invalidation | accepted ref and original-object fences exist separately | must compose them under one result; a retained suppression set is invalid |
| 4 separate receipt insertion/GC/cohort rules | map ownership fixed8, ready whole-attempt proof is distinct | no partial retirement, eviction or ninth permanent saved claim permitted |
| 5 unchanged token bounds/lifetime/shutdown | no spare receipt ownership or new lifetime is adopted | cannot assume an extra persistent proof slot; keep honest backpressure |

Counterexample to a naive display-only shortcut: a terminal receipt names nodes
but fresh FINAL has unavailable/partial/empty text or a Work member instead of a
complete nonempty answer. Suppressing the original preview on raw node existence
would repeat the disappearance symptom. Counterexample to an ID cache: replacing
the original live record or revoking/recreating scope may reuse visible keys while
the old accepted ref is no longer current. Hence the small reason/header seam may
proceed independently; structural duplicate-body retirement is not authorized.

### Explanation Seam Implemented (Structure Still Unchanged)

S eae7780 supplies receipt_capacity/canRetry=false only for the actual blocked
exact-terminal capacity outcomes. D adds its English/Japanese reason and uses the
existing Checking saved response label for confirming previews, not a completed
Core state. The same ninth App control now asserts retained preview plus canonical
body (duplicate still present), visible capacity reason and absent Retry button.
Existing receipt reuse, mixed reasons and lifecycle negatives stay in S's readback
file. Combined both TS and two files/36 controls pass. The first combined attempt
used a nonexistent .when selector, failed one assertion and was corrected to the
actual Message small.mono header; that author fixture error remains separate.
The earlier proposed labels in this table are now implemented, not the proposed
new ownership association. General USER cause/duplicate-body repair is not proven.
