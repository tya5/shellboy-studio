# Thread row actions

Follow the shadcn/ui Sidebar `SidebarMenuAction` pattern for the in-flow action and
its `showOnHover` states, shadcn/ui `DropdownMenu` / Radix for menu dismissal and
surface, and the WAI-ARIA APG Menu Button pattern for keyboard behavior.

References:
- https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
- https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- Approved user mock: https://claude.ai/artifact/3e5smaBg8ic6cMDfvnoV3n

Each row owns local open state. The trigger click captures the trigger for placement;
contextmenu and ArrowDown capture the row. Only one menu is open because the open
Popover dismisses on outside pointerdown before another trigger or row processes its
click/contextmenu, as in Radix DropdownMenu. The opener stores `document.activeElement`
when opening; Escape closes the menu and restores focus there. No shared open-menu
registry or ref-based anchor is used.

On hover-capable devices, show the borderless quiet trigger for row hover,
`:focus-within`, current selection, or an open menu. Touch always shows it. The
32px/44px row and 24px/28px action boxes reserve their action width so titles truncate
in place. The menu uses 168px minimum width, 8px corners, a fine border, the
tokenized `shadow-popover`, and 4px inset. Text-only items use 6px vertical / 8px
horizontal spacing and 6px corners. The separator spans the panel; Delete is last
and uses `bad` with `bad-soft` on hover/focus.
