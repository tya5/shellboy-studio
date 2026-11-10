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

## Four Work Categories And Case Values

Canonical specification bytes: 303080884a0005a5a6183737bb0e90a9aa04b95947c022e3eb869b59bfd47962.
CANONICAL_CASES is the sole literal bundle for classification, render, heading
category, key policy, closed default and tool policy. Its id is the discriminant.
classifySavedHistoryCase selects a bundle from authoritative node/item facts;
canonicalItemCase preserves the selection through normalized/live composition.
The former string-only classifier and route-to-kind tables are deleted.
Core presentation consumes render with an exhaustive switch, grouping consumes
classification/category and key construction consumes keyPolicy. D must consume
these values, not add heading classification. Missing event subtype authority
continues to use generic known notification/unknown; the child/shell notification
cases do not invent a new wire kind or infer causal facts from text.

WorkGroup.categoryCounts contains Tools, Reasoning, Notifications and Problems;
selected equal scoped associations are deduplicated before counts. Conflicts
remain visible unresolved facts. Zero omission and actual execution state are
consumer presentation concerns; counts never imply success. Existing execution
metadata remains separate and genuine unavailable reasons stay inside content.

projectLegacyHistoryItems now accepts liveFacts only with an explicit live domain.
Saved legacy normalization plus qualified live facts are grouped once inside the
existing decoded boundary. Public projectSavedItems proof checks remain unchanged;
no revision is invented and the boundary never qualifies live provenance itself.

Local validation: 248 PASS / 1 TODO across eight focused core files; core TS PASS.
Logs: /tmp/p-category-final-v2.log, /tmp/p-category-final-types-v2.log.
The first metadata expectations/type failure are preserved, not product red claims.
Twenty-five independent named case-column controls plus grouping/legacy-live
negative controls extend the existing per-row matrix. D consumer, UI TS, S6 final
matrix and zero old-symbol whole-union check are still separate gates.
