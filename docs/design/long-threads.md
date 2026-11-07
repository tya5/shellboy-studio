# Long Threads: reading only what shows

Status: implemented (2026-11-07) behind the capability `history.window`, which the bridge advertises only with the Cargo feature `next-shellboy` (built against a Shellboy that has #268, which is on branch `issue-268/history-window-2` and in no release; same pattern as `thread.reparent` in `branches-threads.md`). On v0.10.0 the capability is absent and today's reader stays (`data-layer.md`, "History is a window over the end of the path"). Both paths are tested. When the pin passes a release with `history.window`, the feature gate goes and the arm stays.

User requirement: never fetch the whole history. Read the viewport and a margin, show placeholders for the rest, and never freeze the UI.

Today's cost, measured on a 100,000-node Thread: 1,001 `history.list` calls and 36 s to open, though only the newest 400 items are kept (`data-layer.md`, "Scale").

## Wire (Shellboy #268)

`history.window {thread_id, ordinal?, node_id?, expect_node_id?, before=20, after=20, excerpt_chars=512}`. With neither `ordinal` nor `node_id` the window ends at the last node. `before + after + 1 <= 200`. The result is `{thread_id, revision, total, items}`: items are `history.list` items, ascending, and `selection.ordinal` is the position. A stale position returns `cursor_expired` with details `{revision, total}`. The revision also advances on append, so it can't say by itself that the path was rewritten; `expect_node_id` with `ordinal` does (the node at a position fixes everything before it). The bridge allows `history.window` as a read under `next-shellboy`.

## What the Conversation does

**Behind ui-core.** `ConversationWindow` (`ui-core/src/window.ts`) sits between the data layer and the screen; `WindowedScroll` (console design) draws it. `ThreadHandle.readWindow` sends one read and `historyTick` counts hints. With the capability the store no longer walks `history.list` at all: a `changed` hint only bumps the tick, and the reader decides what to read. `AppModel.longReader` holds the reader while the Conversation shows and the capability is there; leaving the view or the Thread disposes it. Without the capability `longReader` is undefined and the old path runs unchanged.

**Windows, held as an LRU.**

| Item | Bound |
|---|---|
| Window size | 100 nodes, aligned at multiples of 100 (the first read ends at the last node and fills the slots it covers) |
| Windows held per open Thread | 16, so 1,600 nodes at most, least recently shown dropped first |
| Reads running per Thread | 2 window reads, nearest the viewport first, plus one tail or verify read; a window scrolled away before its reply is dropped on arrival |
| Margin | one viewport above and below |
| Pause before requesting | 80 ms without a scroll event |
| Heights | one float per position of the open Thread (8 bytes each, 800 KB at 100,000), the only per-position state kept after a window is dropped |
| Rows in the DOM | those in view plus the margin |

**Variable-height virtual scroll.** The scroller's height is a sum of rows. A row not yet measured uses the mean of those measured, or a fixed estimate for layout before any is. That's a layout placeholder, never shown as a fact. A measured height is kept per position (see the table); a node with nothing to draw (`event`, `context`, `tool_result`, empty) is measured as 0 once its window is read. The mean counts only once some row with a height was measured, so zero-height rows alone don't collapse the estimate. Offsets are sums over a Fenwick tree, so a position to offset and back is logarithmic. Hidden kinds (`event`, `context`, `tool_result`) take no height, but their count can't be known without reading them, so the scroller's position is by node and the bar is approximate. It stays fine for reading, and the total shows as a number.

**Placeholders.** A range not read yet draws `LoadingRows`, sized to the range's estimated height, and its window is requested when it comes within the margin.

**Following.** At the bottom, new rows keep it at the bottom. Scrolled up, it stays put and offers a jump to the newest, and a hint reads nothing. A hint at the bottom reads one window from the last known node on (`ordinal` of that node, `after` 199, `expect_node_id` set), which both fetches the new rows and checks the path.

**Keeping position.** Anchored on the first visible row and its offset. When rows above it get measured or read, the scroll offset is corrected by the height change in the same frame, so the text doesn't move. `overflow-anchor` isn't relied on, since Safari lacks it.

**A path change.** A reply whose revision differs from the known one is not trusted; one read at the newest position known, with `expect_node_id`, decides. If the node is still there the path only grew: the new revision and total are adopted and the windows stay. On `cursor_expired` every window and height is dropped and the view re-reads by the anchor node (`node_id`), else by its ordinal, else at the end, and a note says the conversation was rewritten. Following re-reads the end. The scroll offset is then set so the anchor row keeps its place. A rewind seen while reading doesn't jump to the end.

**Cancelling (user requirement, 2026-11-07).** Reads follow what's showing, with the machinery already in the data layer (`Cancel`, `data-layer.md`). A window is requested only when it comes within the margin, after a short pause in fast scrolling, so a fling across the Thread starts no reads for rows passed over. A window that leaves the margin before its reply is cancelled: dropped if queued, a `cancel` frame if sent. At most 2 are in flight, the newest wanted first, and queued ones that are no longer wanted never go out. Leaving the view or switching Thread cancels all of them. Reads already started at the owner run to the end of their page (`data-layer.md`), so a window should stay small.

**Never freezing.** Rendering is at most the visible rows per frame. Markdown rendering runs when a row first enters the margin, not for the whole window, and long bodies stay collapsed as now.

**Stop, recovery, marks, steps.** Stop, retry and the recovery row never read history items (they come from `thread.get` and the Thread list), so they work wherever the view is. Branch marks are computed from the items in the render range; a mark on a node with no row goes to the row before it, if that is in range. The selected step is found among the held windows, so it stays while its window is held. Covered in `reader-state.test.ts`.

## Needs from core

- Hidden kinds filtered in the window read, so positions and the bar match what shows. Not essential; positions count every node today, so the bar is approximate and the total reads as nodes.
- Assumed, not checked against a real owner: `after` past the end is clamped, a missing `node_id` is an error (any code works, the reader falls back), and a position at or past `total` is `cursor_expired`.

## Tests

`ui-core/test/window.test.ts` (fake owner behind the fake transport, `window-owner.ts`): the first read and no `history.list`; capability or not; no request during a fling and only the margin after a pause; two reads at most; cancel and dropped late reply; the 16-window LRU; anchor correction (the pure function and through the class); append kept, rewrite dropped and re-read at the anchor, rewind without a jump; following, scrolled up, and a path change under a followed tail; leaving sends nothing. `reader-model.test.ts`: the model with and without the capability and on leaving the view.

## Measured

Fake transport seeded with 100,000 nodes, rows given 120 px when drawn (`ui-core/test/window-measure.test.ts`, counts only). Calls are `history.window` calls.

| Case | Result |
|---|---|
| Open | 1 call, 100 nodes held, 0 `history.list` (was 1,001 calls and 36 s) |
| Wheel, 400 notches of 100 px from the middle, pause after each | 4 calls, 0.01 per notch |
| Drag of the scrollbar end to end, 301 moves, no pause | 0 calls during or after (it ends at the tail already held), 0 cancels |
| The same drag with a pause every 20 moves | 18 calls, 18 cancelled before their reply, none installed |
| Jump to the middle | 2 calls; the way back to the newest, 1 call; following again |
| Left mid-scroll with 2 reads running | 2 cancel frames, 0 frames after |

## Not measured

Everything in a browser: first paint, heap, frame times while dragging, the cost of measuring rows with real fonts, Safari and touch behaviour, and the owner's own cost per `history.window`. Counts above come from a fake and say nothing about time. A very tall scroll space (the browsers' element height limits, roughly 10 to 30 million px) was not reached; 100,000 rows at 120 px is 12 million px. Not run against a real owner.
