# Long Threads: bounded measured windows

Status: implemented behind `history.window`. `ConversationWindow` is the ui-core
model; `WindowedScroll` draws it. The bridge's feature/pin controls capability
availability. Without the capability, the existing bounded legacy reader stays
in place. The current scroll contract is `conversation-scroll.md`; the old
mean-height/Fenwick-tree and whole-history scrollbar design is superseded.

User requirement: never fetch the whole history. Read a bounded loaded window,
stop at unread edges, preserve the reading position and do not invent heights.

## Wire (Shellboy #268)

`history.window {thread_id, ordinal?, node_id?, expect_node_id?, before=20,
after=20, excerpt_chars=512}`. With neither `ordinal` nor `node_id` the window
ends at the last node. `before + after + 1 <= 200`. The result is
`{thread_id, revision, total, items}`: items are `history.list` items, ascending,
and `selection.ordinal` is the position. A stale checked position returns
`cursor_expired`. Revision also advances on append; `expect_node_id` distinguishes
an intact prefix from a rewrite. The reader never substitutes a history-list walk.

## Reading lifecycle

`ThreadHandle.readWindow` sends one cancellable read; `historyTick` counts hints.
With the capability the data store does not walk `history.list` on hints. The
reader decides whether to read. `AppModel.longReader` owns one reader while its
Thread's Conversation is open, and disposes it on leaving or switching Thread.

Open reads the last 100 nodes, filling aligned 100-slot buckets. Retain at most
16 buckets (1,600 nodes), evicting the edge opposite the active direction. Draw
one contiguous loaded run only; disconnected retained islands cannot add scroll
height. Unknown row heights contribute zero. Actual measurements and projected
hidden rows are stored only while the corresponding bucket is retained. The
full total is never a storage capacity or a pixel offset.

Near a detached loaded edge, request the adjacent bucket after 80 ms without
movement. At most two bucket reads run; tail, verification and recovery share
one additional lane. Cancel no-longer-wanted reads and reject their late replies.
The model is not a far-position virtual scrollbar: a large scrollTop cannot
select an unloaded ordinal. Return-to-newest is explicit checked navigation,
with the target read before the old run is replaced.

Follow, DOM/model anchor ownership, clicked headings, fitting content, grouped
tools, append, rewrite, errors, disposal and exact state bounds are specified in
`conversation-scroll.md` rather than duplicated here.

## Other Conversation features

Stop, retry and the recovery row use Thread state, not whichever history windows
are held. Branch marks use the rendered run. A mark on a hidden node goes to the
preceding projected row if available. The selected step can be found while its
window remains held; no history walk searches for it after eviction. The browser
continues using the existing tool groups, words, symbols and visual styles.

## Evidence

`ui-core/test/window.test.ts`, `loaded-window.test.ts`, `reader-state.test.ts` and
`window-measure.test.ts` cover measured coordinates, loaded edges, resource
bounds, mutation, navigation, cancellation and recovery. Console tests cover
scroll intent and DOM reading anchors. The synthetic Chrome runner mounts the
production App/Conversation with a fake transport, exercises desktop and mobile
emulation, and writes geometry assertions and PNGs. See
`../development/scroll-verification.md` for commands, results and untested cases.

Historical counts from the estimate-based far-scroll fixture are not current
measurements. Current deterministic counts for 100,000 synthetic nodes: one open
read, 100 reads for 100 older-edge visits, 16 retained buckets/1,600 measurements,
zero reads during 301 uninterrupted drag reports, one pending read cancelled on
leaving, and no `history.list` calls. These are request/storage counts, not browser
or owner timing guarantees. A separate trillion-node metadata fixture checks
that storage does not scale with total.
