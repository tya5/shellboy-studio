# ThreadItem

A sidebar Thread row with a navigable `tree-link` and optional in-flow `tree-action`.
Its `useRowMenu` owns local open state and the placement anchor. Follow shadcn/ui
`SidebarMenuAction` (`showOnHover`): hover-capable devices reveal the action on row
hover, `:focus-within`, selection, or an open menu; touch devices always show it.
The title truncates before the reserved action width. The menu follows shadcn/ui
`DropdownMenu` / Radix and the WAI-ARIA APG Menu Button pattern.


The caller's `linkId` identifies the row link for the owning list's focus claim. The
list sets its claim on row focus and clears it when focus leaves the list. If the
claimed row is removed, the list advances to the next link or its heading.

Styles are colocated in `system/components/ThreadItem/style.css`.

Styles: style.css in this directory
