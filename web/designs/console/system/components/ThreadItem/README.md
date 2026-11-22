# ThreadItem

A sidebar Thread row composed on `ListRow`, with a navigable title, status, count
and depth. `ListRow` owns the in-flow actions and menu state. Follow shadcn/ui
`SidebarMenuAction` (`showOnHover`): hover-capable devices reveal the action on row
hover, `:focus-within`, selection, or an open menu; touch devices always show it.
The title truncates before the reserved action width. The menu follows shadcn/ui
`DropdownMenu` / Radix and the WAI-ARIA APG Menu Button pattern.


The caller's `linkId` identifies the row link for the owning list's focus claim. The
list sets its claim on row focus and clears it when focus leaves the list. If the
claimed row is removed, the list advances to the next link or its heading.

Styles are colocated in `system/components/ThreadItem/style.css`.

Styles: style.css in this directory

Use the child disclosure only on parent rows. The link preserves Left/Right disclosure and the separate action keeps ArrowDown. See patterns/thread-list.md (Orca, shadcn/ui Sidebar, WAI-ARIA tree).

In the sidebar only, unread completion is shown by a bold title, not a badge or distinct status mark (Orca worktrees and sidebar mock 1d). The row menu offers Mark as read or Mark as unread. Do not signal child unread through the parent chip.

The sidebar supplies the unread presentation from `AppModel`; clicking the link does not mark it read until the conversation route and its detail are available. Read/unread menu actions are unavailable when the list row has no answer ID.


List containers have no inline padding. Row hover and selected backgrounds fill their container width, with square ends; rows own their shared-token insets and nested title indentation does not narrow the highlight. Keep trailing row actions in the shared 24px `size-row-action` column; phone hit areas are centered on this column without widening it. References: shadcn/ui SidebarMenuItem/SidebarMenuAction (`showOnHover`), Orca sidebar rows, and approved Studio sidebar mock v8, section 1a B1.
