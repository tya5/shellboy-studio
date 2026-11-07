# Long Threads: reading only what shows

Status: plan (2026-11-07), not implemented. It needs Shellboy #268: a positional window, the total length and a path revision, none of which exist in v0.10.0. Until #268 lands, today's reader stays (`data-layer.md`, "History is a window over the end of the path"). `LoadingRows` is already in the system, and shows while a Conversation loads.

User requirement: never fetch the whole history. Read the viewport and a margin, show placeholders for the rest, and never freeze the UI.

Today's cost, measured on a 100,000-node Thread: 1,001 `history.list` calls and 36 s to open, though only the newest 400 items are kept (`data-layer.md`, "Scale").

## What the Conversation will do

Wire details wait for #268 and aren't guessed here. This assumes only what the issue names: read a window at a position, know the total, know a revision that changes when the path is rewritten.

**Behind ui-core.** One new class in ui-core, say `ConversationWindow`, between the data layer and the screen. The screen asks it for rows in a range and tells it which range is showing. It knows nothing about pixels other than the heights it's told. `ThreadHandle.history` stays for the old reader until a capability says the owner has the new read, and then a single switch in `AppModel` chooses.

**Windows, held as an LRU.**

| Item | Bound |
|---|---|
| Window size | 100 nodes, the existing page |
| Windows held per open Thread | 16, so 1,600 nodes at most, least recently shown dropped first |
| Reads running per Thread | 2, newest request first; a window scrolled away before its reply is dropped on arrival |
| Margin | one viewport above and below |
| Rows in the DOM | those in view plus the margin |

**Variable-height virtual scroll.** The scroller's height is a sum of rows. A row not yet measured uses the mean of those measured, or a fixed estimate for layout before any is. That's a layout placeholder, never shown as a fact. A measured height is kept per node in a bounded map (the same LRU). Hidden kinds (`event`, `context`, `tool_result`) take no height, but their count can't be known without reading them, so the scroller's position is by node and the bar is approximate. It stays fine for reading, and the total shows as a number.

**Placeholders.** A range not read yet draws `LoadingRows`, sized to the range's estimated height, and its window is requested when it comes within the margin.

**Following.** At the bottom, new rows keep it at the bottom. Scrolled up, it stays put and offers a jump to the newest. A hint at the bottom reads only the last window.

**Keeping position.** Anchored on the first visible row and its offset. When rows above it get measured or read, the scroll offset is corrected by the height change in the same frame, so the text doesn't move. `overflow-anchor` isn't relied on, since Safari lacks it.

**A path change.** When the revision differs (compaction, rewind, prune), every window is dropped and the visible position re-reads by the anchor node if it still exists, otherwise at the nearest ordinal, with a small note. A rewind seen while reading doesn't jump to the end.

**Never freezing.** Rendering is at most the visible rows per frame. Markdown rendering runs when a row first enters the margin, not for the whole window, and long bodies stay collapsed as now.

## Needs from core

- #268: a positional window, the total length and a path revision.
- Whether hidden kinds can be filtered in the window read, so positions and the bar match what shows. It isn't essential.

## Tests to write then

Fake-transport tests of the LRU, of dropped replies, of the anchor correction as a pure function, of a revision change, and of following. In a browser: the same 100,000-node seed, measuring first paint, heap and frame times while dragging through the whole Thread.
