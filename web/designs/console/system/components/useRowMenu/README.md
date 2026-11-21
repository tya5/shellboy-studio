# useRowMenu

The row owns its placement anchor and focus-return target in state. The trigger click
anchors to the button; row contextmenu and ArrowDown anchor to the row while retaining
the button as the Escape focus target. A shared active-owner decision closes any
previous row menu synchronously without depending on outside-pointer event ordering.
The visibility/open behavior follows shadcn/ui `SidebarMenuAction` (`showOnHover`)
and the WAI-ARIA APG Menu Button pattern. It uses no ref for the placement anchor.
