# Canonical Presentation Caller Migration

Baseline: 277f27073a77a5bed565fc772bd4baab829ebd9d (preserved).
The former projection function/export is deleted, not aliased or renamed in place.
Canonical semantics now come from one whole-input projectLegacyHistoryItems call.
materializeHistoryPresentation exposes that projection, presentation rows,
independent execution steps, and actual nodeIdByRowId provenance.
collectExecutionSteps never classifies a node or releases an aggregate body.

| Caller | Canonical Input / Output | Removed Fork |
| --- | --- | --- |
| model conversation | history nodes -> presentation.rows | old independent function |
| model branch marks | whole bounded range -> presentation.rows | per-node projection |
| model selected tool | collectExecutionSteps on retained facts | semantic row traversal |
| model retention | bounded canonical presentation | old function reference |
| tiles | returned typed/legacy nodes -> presentation | old function reference |
| Window measurement | actual measurement only | classification-based height zero |
| Console / WindowedScroll | D-owned migration to presentation + provenance map | separate author child required |

Existing safety controls now use the canonical API. Historical expectations that
hid records, rendered unproved excerpts, or inferred completeness from length
are replaced by explicit record-presence/nonexposure/typed-completeness assertions.
Branch points on retained tool nodes remain on those nodes. Actual execution
sidefacts are deduplicated and keep command/status/duration facts without deciding
conversation membership. Whole-input projection and multi-item provenance have a
new named control; every semantic row has an actual node provenance entry.

Local validation: 8 files, 221 PASS / 1 TODO; core TypeScript PASS.
Logs: /tmp/p-delete-final.log and /tmp/p-delete-final-core-types.log.
The first migrated run had 9 obsolete shape expectations (184 PASS); its log is
preserved at /tmp/p-delete-focused.log. No tests were skipped.
D's separate two-file migration is required before UI typecheck and whole-web
zero-reference verification. Historical documentation is outside executable scope.
No push, CI dispatch, browser, RPC, installed operation or user Thread claim.
