# BranchList

- **Use for:** Read the same family as BranchGraph in an indented list, always on phones and optionally on wide frames.
- **Do not use for:** Use BranchGraph when a wide frame can show the family topology at a glance.
- **Why:** Links and divergence actions stay available without requiring lateral scrolling.
- **Source:** [Studio Branches design](../../../../../../docs/design/branches-threads.md#branches-what-is-real)

The same family as BranchGraph, as an indented list: the only layout at phone width, and a choice on a wide frame. Each row opens that Thread; `action` chooses the point where it left its parent.

Styles are colocated in `system/components/BranchList/style.css`.

Styles: style.css in this directory
