# BranchList

- **Use for:** Read the same family as BranchGraph in an indented list, always on phones and optionally on wide frames.
- **Do not use for:** Use BranchGraph when a wide frame can show the family topology at a glance.
- **Why:** Links and divergence actions stay available without requiring lateral scrolling.
- **Source:** [Studio Branches design](../../../../../../docs/design/branches-threads.md#branches-what-is-real)

The same family as BranchGraph, as an indented list: the only layout at phone width, and a choice on a wide frame. Each row opens that Thread; `action` chooses the point where it left its parent. Capability-gated excerpts are read only for visible rows, appear below row metadata, and use a one-row LoadingRows placeholder while a visible row's bounded read settles; offscreen placeholders are aria-hidden. The text keeps the full column beside the mark; `action` controls sit below it in the same column, so the row grows instead of squeezing the text in any frame.

Styles are colocated in `system/components/BranchList/style.css`.

Styles: style.css in this directory
