# BranchLanes

- **Use for:** Show a Thread family as vertical commit-graph lanes (top is oldest): where each line of work splits off, its messages, and its latest message, with actions on a selected message opening under it.
- **Do not use for:** A single message's branch link inside a conversation (use BranchMark), or dozens of short exploratory branches, where lanes get wide (fold them first).
- **Why:** Git GUIs (GitKraken, VS Code Git Graph, Sourcetree) show branches as coloured lanes with the name on the latest commit; acting on a selected row keeps fork and rewind next to the history they depend on. Research and sources: `docs/design/branches-redesign-research.md`; contract: `docs/design/branches-threads.md`.
- **Source:** [Studio Branches design](../../../../../../docs/design/branches-threads.md#branches-what-is-real)

Each lane has a colour slot from the three chart tokens (`chart-1` to `chart-3`) and is always written next to its name (`LaneName`), so colour never carries meaning alone; a fourth lane repeats a colour and keeps its name. Splits are diamonds, a lane's latest message is a ringed point, and a run of hidden messages is a dashed stretch with its count.

**No layout jumps.** Lane width is one `space-24` column per open lane (`space-16` + `space-4` at phone width), and each row kind has a fixed height: a message point is `size-control` + `space-8` on a wide frame and `size-touch` (44 px) on a phone, the name line above a tip and the split line below a split are `size-row-action`, and a run is `size-control` (`size-touch` on a phone). Text is one line with an ellipsis. Only the selected row grows, by its actions. Rows are keyed by Core IDs, so a re-read with the same facts keeps every row element, its focus and the scroll position.

Rows are buttons: a click or tap selects a message and opens its actions under it (never hover). A run is a button only when it can open more messages. `onVisible` reports rows entering and leaving the viewport through one IntersectionObserver, so the screen reads text only for rows on screen; without an observer every row counts as seen.

Styles are colocated in `system/components/BranchLanes/style.css`.

Styles: style.css in this directory
