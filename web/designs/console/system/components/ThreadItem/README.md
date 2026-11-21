# ThreadItem

A sidebar Thread row with a navigable `tree-link` and optional in-flow `tree-action`.
Its `useRowMenu` owns one opener and menu state. Follow shadcn/ui
`SidebarMenuAction` (`showOnHover`): hover-capable devices reveal the action on row
hover, keyboard focus-visible inside, selection, or an open menu; touch devices
always show it. The title truncates before the action.
