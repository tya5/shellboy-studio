# CI 5002: Finite D-Owned Repairs

Original CI 42835252587 reported 29 failures. This child addresses only the
assigned operations/apps/branch-receipt and Console files. S owns handoff/window
atomic tests; P owns reader-state tests. Their results are not implied here.

| Original Failure | Source Classification | Repair And Preserved Oracle |
| --- | --- | --- |
| Operations success and lost reply (2), app creation, branch boundary/combined/diagnostic/fork receipts | Successful fixtures returned arbitrary objects instead of required MessageAccepted IDs | Supply nonempty canonical message_id and the dispatched thread_id. Keep operation ID, immutable payload, replay, epoch/reentry and read-side-effect assertions; no decoder relaxation. |
| Phone CSS contract | Global media-query prohibition contradicted the authorized permanent-footer desktop24/mobile12 exception | Exclude only the exact footer media rule; still reject every other width media query and retain container/tab/touch assertions. |
| Final product retry chrome | Mock lacked the public handoffRetryState signal | Provide actual failed lookup/canRetry state; retain nested Work identity, overflow and no duplicate footer checks. |
| Final product actual reason | Expected an unavailable reason in a closed heading | Keep it out of the heading and verify the same actual reason in the opened item. |
| Smoke bare live_end | No exact saved-node/terminal transfer proof was provided | Retain live and independent saved text; do not retire on bare end or body/timestamp equality. |
| Smoke unanchored live relative to a new human (2) | No public turn/receipt/ordinal anchor supported the old cross-source insertion assumption | Assert independent visibility and actual saved-node identity; retain canonical saved order. Names now explicitly describe this boundary. No production sorting change. |
| Smoke no live capability | Actual legacy rendering gap: accepted ledger text reached projection without a capability guard | Gate handoff facts on live.text. Ordinary saved content remains unchanged. |
| Smoke app error report | Generic fake-owner success object failed strict send decoding | Supply a typed message receipt only for that reviewed report dispatch; retain safe text and destination assertions. |
| Spill call placeholder | Expected a synthetic body-unavailable error without such a public reason | Assert metadata/count unavailable and absence of synthetic error; retain call identity, exact DOM/open state across replacement and hidden original node metadata. |
| Output-frame empty/body (2) | Fixture had shell metadata but no actual typed tool item, and used obsolete group-open keys | Supply a tool item with explicit execution association; open the actual default-closed Work through its DOM action, settle the mounted read, and verify nearest Work. Preserve empty/body output, held refresh, immutable output snapshots and unchanged-result notification assertions. |

No skip, blanket oracle deletion, timeout expansion, new harness, raw tool-payload
recovery, model resubmission or timestamp/body ordering heuristic is introduced.
The old unanchored-live ordering assumptions are explicitly superseded, not
claimed to have been runtime regressions. This does not establish an insertion
anchor contract or resolve the separate observed pending-to-saved position jump.

Final owned validation: both TypeScript checks; 11 files / 578 tests passed,
execution 1dbfa26e-aa06-42d3-9eeb-dde78693b6fc. Log:
.local/validation/final-spec/ci-owned-repairs-v4.log. The existing localhost:3000
ECONNREFUSED stderr also occurred in this successful run; it remains preserved
and is not asserted to explain the original CI failures. Frontend failure followed
by missing dist is not classified as an independent product failure.

Intermediate syntax/fixture type failures and output-child effect timing failures
remain in the original private validation logs. No full-suite rerun, CI retry,
preview restart, browser, user message dispatch or Core binary swap occurred.
