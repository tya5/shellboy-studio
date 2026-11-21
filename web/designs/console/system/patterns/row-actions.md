# Thread row actions

Follow the shadcn/ui Sidebar `SidebarMenuAction` pattern for the in-flow action and
its `showOnHover` states, shadcn/ui `DropdownMenu` / Radix for menu dismissal and
surface, and the WAI-ARIA APG Menu Button pattern for keyboard behavior.

References:
- Radix ContextMenu pointer placement: `context-menu:254,256`; Popper alignment-axis shift: `popper:244`.
- https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
- https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- Approved user mock: https://claude.ai/artifact/3e5smaBg8ic6cMDfvnoV3n

Each row owns local open state. A button click anchors at its trigger; contextmenu
places the panel at the pointer with side-right/align-start placement and collision
shift; ArrowDown anchors at the row. Pointer opening focuses
the menu panel, while ArrowDown focuses its first enabled item. Selection returns
focus to the trigger; Escape restores the captured opener and Tab closes without
moving focus itself. Triggers and menu are linked through `aria-controls` and
`aria-labelledby`. Arrow movement does not loop, Home/PageUp and End/PageDown jump
between ends, and printable keys use typeahead.

The open Popover renders a transparent full-viewport modal layer below the panel. It
consumes outside pointerdown without closing; the following click, auxclick, or
contextmenu closes the menu without activating content beneath it. Opening row B
while A is open therefore only dismisses A. No shared open-menu registry or
ref-based anchor is used.

On hover-capable devices, show the borderless quiet trigger for row hover,
`:focus-within`, current selection, or an open menu. Touch always shows it. The
32px/44px row and 24px/28px action boxes reserve their action width so titles truncate
in place. The menu uses 168px minimum width, 8px corners, a fine border, the
tokenized `shadow-popover`, and 4px inset. Text-only items use 6px vertical / 8px
horizontal spacing and 6px corners. The separator spans the panel; Delete is last
and uses `bad` with `bad-soft` on hover/focus.
