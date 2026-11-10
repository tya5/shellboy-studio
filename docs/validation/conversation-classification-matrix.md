# Section 2 Canonical Classification Matrix

Source specification: conversation-spec.md Section 2 (f883 clean bytes).
Implementation: web/ui-core/src/conversation-items.ts classifySavedHistoryFact.
NODE_MATRIX exhaustively covers the internal specification vocabulary; it is NOT
a new public DTO union. ASSISTANT_ITEMS exhaustively covers HistorySavedItem.kind.
Unknown runtime node kinds map to record. No role, phase, prefix or JSON test.

| Spec Row / Exact Named Test | Classifier Route | Test File |
| --- | --- | --- |
| 01 user human | user / conversation | conversation-matrix.test.ts |
| 02 user model | user / conversation | conversation-matrix.test.ts |
| 03 user external_cli | user / conversation | conversation-matrix.test.ts |
| 04 user unknown sender | user / conversation | conversation-matrix.test.ts |
| 05 assistant authoritative TEXT any phase | text / conversation | conversation-matrix.test.ts |
| 06 assistant tool_call function_call | tool / work | conversation-matrix.test.ts |
| 07 assistant reasoning readable contract absent | reasoning_unavailable / work | conversation-matrix.test.ts |
| 08 encrypted opaque empty reasoning | reasoning_unavailable / work | conversation-matrix.test.ts |
| 09 tool_result ordinary typed text is tool not unavailable | tool / work | conversation-matrix.test.ts |
| 10 spill | tool / work | conversation-matrix.test.ts |
| 11 summary | summary / conversation | conversation-matrix.test.ts |
| 12 event | record / work | conversation-matrix.test.ts |
| 13 context context_note | record / work | conversation-matrix.test.ts |
| 14 model_stream_observation observation | record / work | conversation-matrix.test.ts |
| 15 message notification record | record / work | conversation-matrix.test.ts |
| 16 interruption_details | interruption / work | conversation-matrix.test.ts |
| 17 interruption_context | interruption / work | conversation-matrix.test.ts |
| 18 incomplete_response | interruption / work | conversation-matrix.test.ts |
| 19 interrupted_wait | interruption / work | conversation-matrix.test.ts |
| 20 legacy assistant without safe text authority | record / work | conversation-matrix.test.ts |
| 21 genuine unavailable actual reason | unavailable / work | conversation-matrix.test.ts |
| 22 unknown bookkeeping internal | record / work | conversation-matrix.test.ts |
| 23 definitively empty ordinary | ordinaryEmpty / conversation | conversation-matrix.test.ts |
| 24 pending accepted held INPUT is separate not Work | normalizeLiveWorkFacts excludes pending input | conversation-matrix.test.ts |

## Evidence And Limits

New matrix before implementation: 13 failed / 12 passed. After implementation:
61 passed / 1 TODO across matrix and existing item projection tests; both TS checks
pass. Original logs: /tmp/p-matrix-red.log, /tmp/p-matrix-green-v3.log,
/tmp/p-matrix-types-v3.log. Tests include ordinary typed and legacy tool_result
versus genuine unavailable actual reason, aliases, all four interruptions, human
literal text, sender provenance and assistant arbitrary phase. Readable reasoning
remains marker-only because the current public typed contract has no readable variant.

BUG3 actual user Thread is UNKNOWN: O source audit shows Console requests items:true
and decoder preserves typed tool/executions. This patch fixes the concrete missing-items
tool_result normalization branch and proves typed tool is not normalized unavailable;
it does not establish that this branch caused the reported user symptom.

Legacy projectConversation and renderer presentation are separate consumer seams:
do not call this mapper matrix an all-path/DOM acceptance. D must consume the shared
classifier rather than copy kind logic. Full CI, user Thread and installed acceptance
remain unverified. No DB/RPC/browser/owner/version operation.

## Early-Sidefact Crosspath Correction

The prior c512 adapter checkpoint did NOT remove all early semantic branches in
projectConversation. The S6 event/context, interruption-with-execution and
text-without-excerpt counterexamples are accepted. Those early spill/execution
continues are removed: projectLegacyHistoryItems supplies every semantic row
before execution metadata is appended independently. No HIDDEN_KINDS remains.
Unknown/internal nodes have a canonical empty record note, not synthetic unavailable.
Typed assistant text is emitted per item, without excerpt gating or string joining.

Each Section 2 named row additionally has a `legacy crosspath <row name>` test
with execution sidefacts. Dedicated controls exercise all four interruption
variants, event/context payload non-exposure and two typed text items without an
aggregate excerpt. Tests preserve the node row alongside actual execution facts.
The old publication expectation for unsafe legacy aggregate is now an explicit
record expectation; body hiding remains asserted, with no skip.

Evidence: /tmp/p-crosspath-red.log (3 failing concrete controls),
/tmp/p-crosspath-allrows.log (89 PASS / 1 TODO), and
/tmp/p-crosspath-allrows-types.log (both TypeScript checks pass).
This is local mapper/core projection evidence. D real consumer adoption, full
suite and real user Thread results remain separate. User has prohibited push,
CI dispatch, remote operations and installed changes; none were performed.
