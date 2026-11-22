# Sidebar Thread list

Read the sidebar list and its next page with `order: created`; keep the owner's
creation order within sibling sets, including Pinned. Ancestry determines
placement, not client arrival time. Status changes only the mark and child
summary, never row order. Show Pinned first when any listed Threads carry the
`pin` tag: each pin is a top-level row with all its listed descendants, even
under another pinned root. All is always present and shows every listed Thread
at its natural parent. Do not group by directory, sort by client arrival time,
or keep a second order registry.

A heading uses ThreadGroup. A row uses ThreadItem on ListRow, with a separate
native navigation link, child disclosure, and row action button. The child count
counts loaded descendants, and opening the chip reveals all of them, even
through closed intermediate rows. Start children collapsed; selection highlights every copy and opens its bands and ancestors.
Manual folds that follow win and are stored by band and row path. Left/Right on the parent link close/open
its children, and Down retains the row menu behavior described in row-actions.md.
On phone, reserve 44px for the action and keep it visible. Filters are arguments
on the existing Thread list, including directory. Show flat owner results in
All and only matching pinned roots with no descendants in Pinned while filtering.
Status and pin membership are projections of results
refreshed by existing list change and resync hints. The open filter menu uses the same hints to refresh the owner's paged tag and directory catalogs. Do not add unread styling here (#64).

References: Orca sidebar (grouping and filters), shadcn/ui Sidebar (action spacing),
WAI-ARIA tree (disclosure keys) and Menu Button (row actions).
