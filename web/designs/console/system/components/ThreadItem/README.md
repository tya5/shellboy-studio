# ThreadItem

A sidebar Thread row with a navigable `tree-link` and optional in-flow `tree-action`.
Its `useRowMenu` owns local open state and the placement anchor. Follow shadcn/ui
`SidebarMenuAction` (`showOnHover`): hover-capable devices reveal the action on row
hover, `:focus-within`, selection, or an open menu; touch devices always show it.
The title truncates before the reserved action width. The menu follows shadcn/ui
`DropdownMenu` / Radix and the WAI-ARIA APG Menu Button pattern.
