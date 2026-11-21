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
