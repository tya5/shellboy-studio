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

All is Core's default list (`archived: exclude`), so it shows no archived Thread;
the sidebar has no Include archived filter. Archive (#126) is the last band,
present when the owner has archived Threads. It is its own read, `thread.list`
with `archived: "only"` and the applicable filters, in Core's created order
(updated order while filtering, like All), in pages of 50 with its own Show more
up to 1000 rows, into the same row cache by ID. It is built like All: an archived
child sits under its archived parent, and an archived child whose parent is not
archived is a root in Archive (no parent is guessed). The pinned read includes
archived Threads (`archived: "include"`), so an archived pin stays in Pinned with
its loaded descendants; as a pin also keeps its copy in All, an archived pin also
keeps its copy in Archive. Needs-you hides Archive as it hides Pinned, and its
read is not sent. Archive is re-read on resync, a filter change, and a list hint
whose rows changed archive state, parent or a filtered field. Monitor sets the
shared list to include archived Threads for its own scope, so while Monitor is
shown All lists them flat as before (not changed by #126).

A band count is Threads: pinned Threads for Pinned, listed rows for All and
Archive. It carries `+` when Core says more exist: a list continuation for All
or Archive, a pinned read stopped at its bound for Pinned. A row's question count carries `+` when
the owner marks it inexact (`awaiting_named_count_exact: false`). Never show a
lower bound as an exact number. Do not group by directory, sort by client arrival time,
or keep a second order registry.

A heading uses ThreadGroup. A row uses ThreadItem on ListRow, with a separate
native navigation link, child disclosure, and row action button. The child count
counts loaded descendants, and opening the chip reveals all of them, even
through closed intermediate rows. Start children collapsed; selection highlights every copy and opens its bands and ancestors.
Pinned and All start open and store a close (`sidebarClosedGroups`); Archive starts
closed and stores an open (`sidebarOpenGroups`).
Manual folds that follow win and are stored by band and row path. Left/Right on the parent link close/open
its children, and Down retains the row menu behavior described in row-actions.md.
On phone, reserve 44px for the action and keep it visible. Filters are arguments
on the existing Thread list, including directory. Show flat owner results in
All and only matching pinned roots with no descendants in Pinned while filtering.
Status and pin membership are projections of results
refreshed by existing list change and resync hints. The open filter menu uses the same hints to refresh the owner's paged tag and directory catalogs. Unread completion is a bold title (#64, ThreadItem README).

References: Orca sidebar (grouping and filters), shadcn/ui Sidebar (action spacing),
WAI-ARIA tree (disclosure keys) and Menu Button (row actions).
