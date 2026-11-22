# Sidebar Thread list

Read the sidebar list and its next page with `order: created`; keep the owner's
order within each directory and in Pinned. Ancestry determines disclosure, not
placement. Status changes only the mark and child summary, never the row order.
Place the `pin` tag group first, then sort directory headings by name. Do not
sort by client arrival time or keep a second order registry.

A heading uses ThreadGroup. A row uses ThreadItem on ListRow, with a separate
native navigation link, child disclosure, and row action button. The child count
summarizes loaded descendants across display groups; disclosure opens local rows. Start children collapsed;
selection opens its group and displayed ancestors through the saved disclosure preferences; later manual folds win. Left/Right on the parent link close/open
its children, and Down retains the row menu behavior described in row-actions.md.
On phone, reserve 44px for the action and keep it visible. Filters are arguments
on the existing Thread list; status and pin membership are projections of results
refreshed by existing list change and resync hints. The open filter menu uses the same hints to refresh the owner's paged tag and directory catalogs. Do not add unread styling here (#64).

References: Orca sidebar (grouping and filters), shadcn/ui Sidebar (action spacing),
WAI-ARIA tree (disclosure keys) and Menu Button (row actions).
