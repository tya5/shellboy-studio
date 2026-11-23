# BranchMark

- **Use for:** Link from a conversation row to an owner-reported divergence; put a point with no visible node on the preceding row.
- **Do not use for:** Use BranchGraph or BranchList to show the whole family; don't infer a divergence from local row order.
- **Why:** The inline mark keeps the branch's actual context; the quiet branch/rewind link stays visible on phones.
- **Source:** [Studio Branches design](../../../../../../docs/design/branches-threads.md#branches-what-is-real)

Sits on a conversation row where one or more branches leave the path, and links to that point in Branches. Show it only when `thread.branches` reports the point; never infer it. A divergence on a node the conversation doesn't show goes on the row before it.

Beside it, a quiet `Branch or rewind from here` link appears on hover or focus on a wide frame and stays visible at phone width.

Styles are colocated in `system/components/BranchMark/style.css`.

Styles: style.css in this directory
