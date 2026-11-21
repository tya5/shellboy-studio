# useRowMenu

The row owns menu open state and captures the opener element in state when opened.
The trigger click anchors to the button; row contextmenu and ArrowDown anchor to the
row. It returns row handlers, the in-flow trigger, `menu`, and `open`; it uses no
ref or custom DOM event. The visibility and open behavior follow shadcn/ui
`SidebarMenuAction` (`showOnHover`) and the WAI-ARIA APG Menu Button pattern.
