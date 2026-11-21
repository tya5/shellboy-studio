# useRowMenu

Each row keeps local open and placement-anchor state; no shared registry or
ref-based placement anchor is used. A pointer button click opens at its trigger; native keyboard activation (click
`detail === 0`, including Enter/Space) uses keyboard-open focus. Right-click
opens at the pointer coordinates, with side-right/align-start placement and collision
flipping, while ArrowDown opens at the row and focuses the
first menu item. Pointer opening focuses the menu panel. The trigger and menu are
linked by `aria-controls` and `aria-labelledby`.

Selecting an entry closes the menu and returns focus to the opening button. Escape
returns focus to the element captured when opening; Tab closes and lets focus move.
ArrowUp/ArrowDown stop at the ends; Home/PageUp and End/PageDown jump to the ends;
printable characters perform typeahead. Outside pointerdown is consumed by the
modal Popover layer, and the following click/auxclick/contextmenu dismisses the menu
without activating the underlying row. A long-press opens only on browsers that
produce `contextmenu` for it.

References: Radix `dropdown-menu`/`menu` and `context-menu` source, shadcn/ui
`SidebarMenuAction`, and WAI-ARIA APG Menu Button/Menu patterns.
