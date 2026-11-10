# Shared Projection In The Console Legacy Consumer

This local-only child consumes P c512edb and a573b5d. It does not add a classifier.
Both history.window and history.list now pass their saved nodes to the canonical
mapper and then the same SavedConversationItems renderer. The unversioned legacy
adapter is necessary because supported history.list has canonical node IDs but no
Window revision. It is not permission to invent a revision or relax the public
projectSavedItems identity boundary.

## Removed Parallel Paths

- Removed legacy rows.flatMap rendering and its independent assistant aggregate
  guard. All saved nodes, including internal records, reach the adapter first.
- Removed RowView's publication/steps/note branches and the untyped message/body
  fallback. ProjectedMessage accepts only a message presentation plus explicit
  authorized text from the canonical projection.
- Removed Console's unused WindowedScroll renderRow semantic fallback. This caller
  always supplies renderAcceptedView. Other callers' API remains unchanged.
- P separately removed hidden kinds and early spill/execution continues; execution
  sidefacts feed metadata only and cannot erase the canonical node/item row.

LegacySavedContent preserves the preexisting captured live cut as layout ordering,
not classification. Branch controls remain independent, keyed structural metadata.
LiveMessage stays the existing live-only surface, not a saved authority source.

## Controls And Limits

The same strict public DTOs render through real App with history.window enabled
and disabled: internal event/context (including literal from-thread text) are Work
records with no conversation payload/sender; human text mentioning event/context
and legitimate received user provenance stay ordinary conversation. Existing tool
JSON unsafe-prose controls remain. Smoke explicitly opens closed native Work
before inspecting nested tools; it no longer demands raw legacy reasoning excerpt
as conversation text and instead asserts internal record presence/nonexposure.

Final local run: both TypeScript configurations; 168 tests across seven files,
execution b90a837c-8b80-40cb-a9cb-9f7630c0975b, private
.local/validation/final-spec/local-shared-cleanup-final.log. Includes migrated BUG2
15 controls, separate terminal six controls, shared matrix and footer lifecycle.
Earlier local type/source-oracle/order failures are preserved, not successful runs.

Gutter source now uses existing 24/12 tokens, unchanged height formula and direct
stable footer. The source control is not a browser measurement or image approval.
No CI, push, workflow, browser, installed swap, database or RPC was performed.
This is not S6's independent final-SHA/current-spec conformance determination.
