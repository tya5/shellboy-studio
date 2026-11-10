# BUG2 Owned Pipeline Expectation Migration

Base: a2220923a04e83bc2a388fac402480fa74649e19 (official S/O terminal
persisted proof chain and D consumer). Only the owned test and this map change.

USER17927 supersedes the previous whole-overlay-retain policy. This is a policy
migration, not a claim that the old implementation failed its old contract.
The prior source remains in Git at the base and in the author's preserved
`.local/validation/old-policy-source.txt`. Prior logs remain unchanged.

| Previous expectation | New expectation / reason |
| --- | --- |
| Completed attempt keeps whole live until all typed item reads finish | Terminal plus nonempty public exact refs hides live before typed readback |
| Partial/deferred item readback prevents retirement of live | Available saved rows remain visible; terminal fact is sufficient for live OFF |
| Truncated coverage cannot release overlay | Nonempty exact persisted refs suffice even when coverage is truncated |
| Full-ready rows and retiredAttempts must be reached | terminalPersistedAttempts may win first; full-ready timing is not required |
| Member presentation is hidden while completed proof is pending | Once terminal persistence is confirmed, pending is cleared and available member is visible |
| Failed terminal unmask only | Failed terminal also hides the live block with the same-current-ref terminal fact |

Nonterminal, empty references, wrong thread, and paused-handle negatives still
require no terminal fact and live retention. Pausing a handle is not owner ABA.
A distinct attempt's referenced saved node remains visible beside available
current-attempt saved members; only current-attempt live is removed. No turn
field/pin/API is introduced. The structurally impossible same-attempt/different
turn experiment is not reinstated.

The inherited changed-hint mode is not used as a repair workaround. Reentry
covers layout notification only, not a release-end counter. These act/microtask
DOM observations are not browser paint evidence. Available row assertions do
not assert complete text coverage or materialization of unavailable rows.

Validation: f71ad497-b751-441d-a12f-0879aa2024bf exit 0: 15 focused tests and
both TypeScript configurations. Original log:
`.local/validation/bug2-migration-final.log`.
Initial migration run 44834c14-60b2-4111-a330-24b43fba4981 had 13 pass / 2 fail
in a provisional nonterminal-pending expectation; preserve it separately as
fixture/policy alignment evidence, not a product regression/red-first repair.
No broad suite, real Thread, network, browser, DB, or installed trial was run.
