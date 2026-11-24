# Sidebar Thread list

The pinned set is read completely; Studio orders its rows newest first by `created_at`,
as in Core's created order.
Filtered All results stay in Core's updated order. Ancestry determines
placement, not client arrival time. Status changes only the mark and child
summary, never row order. Needs-you excludes query, tags and directory filters;
while it is active, hide Pinned rather than filtering it client-side. Show Pinned
first when the owner's pinned set is not empty. That set is its own read, `thread.list` with the `pin` tag (and the
applicable filters), walked in pages of 50 up to 1000 rows into the same row cache
as the list, so a pin older than the loaded pages still shows. Tags on loaded
rows do not decide membership. Each pin is a top-level row with all its listed
descendants, even under another pinned root. All is always present and shows
every listed Thread at its natural parent.

A band count is Threads: pinned Threads for Pinned, listed rows for All. It
carries `+` when Core says more exist: a list continuation for All, a pinned
read stopped at its bound for Pinned. A row's question count carries `+` when
the owner marks it inexact (`awaiting_named_count_exact: false`). Never show a
lower bound as an exact number. Do not group by directory, sort by client arrival time,
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
refreshed by existing list change and resync hints. The open filter menu uses the same hints to refresh the owner's paged tag and directory catalogs. Unread completion is a bold title (#64, ThreadItem README).

References: Orca sidebar (grouping and filters), shadcn/ui Sidebar (action spacing),
WAI-ARIA tree (disclosure keys) and Menu Button (row actions).
