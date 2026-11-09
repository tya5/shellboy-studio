# T8 Late Reference Qualification

Limited residual fix on `83dabe0ba858324ac8dd150d3fdcf97a7e23f1a8`.
No new RPC, timing/JSON-shape heuristic, arbitrary legacy hiding or span model.

Two author tests fail on the base: a legacy aggregate was rendered before later
status supplies an exact function_call reference, with no history-changed hint.
S7 independently reports 13 raw/visible RAF frames after that evidence in late and
mixed cases at 1280/390 widths, distinct from ten existing zero-exposure cases.
Initial unqualified legacy prose is not counted as failure. This is an author
source repair, not yet independently validated on the fixed commit.

Late status atomically fences matching retained aggregates to unknown and publishes
work. It invalidates older history generation before notification, so an old read
cannot restore raw legacy facts. Existing bounded qualification may establish exact
tool identity, not tool-body publication. Multiple refs on one aggregate remain
unknown. Whole observed-scope validity precedes candidate selection. Missing refs
do not hide unrelated legacy/user JSON; ordinary final-answer JSON remains readable.

| Anchor | Effect | Immutable Fence | Synthetic Coverage |
| --- | --- | --- | --- |
| readWork loading setter | UI then status read | Captured owner, work operation generation, Cancel and live epoch; check after setter | sync cancellation => status zero |
| status await | Work and history projection | Same token after await, current connected owner/pause/ref checks | late cancel/pause/owner/ABA discarded |
| pending original-body reads | Existing bounded cache | Same token before RPC and after Promise.all | existing work tests; no increased limits |
| history/work batch exit | Unknown gate and evidence together | Token before batch; exact node only; history generation invalidated | legacy/mixed red-green; unrelated legacy/user JSON |
| post-batch refresher | Existing bounded read only | Same token after subscriber callbacks | no invalid continuation/new owner dispatch |
| publication qualification | Existing shared budget/read | Existing owner/history generation/Cancel plus whole-scope checks | scope/truncation/error/ambiguity and ordinary JSON controls |

No new queue/task/cache/timer is added. Existing shared C1 8-record/1MiB/8-RPC and
one-flight admission remain unchanged; hints do not replenish explicit-generation
budgets. Cancellation does not release a qualification admission before settlement.
There is no new work finally that can clear a newer admission. The existing
Refresher settles its own task. Read proof is not reused across owner transitions.

Synthetic transport/happy-dom and S7 desktop RAF are not actual owner/phone tests.
Live text without authoritative provenance is not reclassified by serialized shape.
No installed binary, running owner or real data is touched.
