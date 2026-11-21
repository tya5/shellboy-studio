# Thread row actions

Follow the shadcn/ui Sidebar `SidebarMenuAction` pattern for an in-flow row action and its `showOnHover` visibility, and shadcn/ui `DropdownMenu` / Radix for menu surface, separators, item focus and destructive treatment. The trigger and menu follow the WAI-ARIA APG Menu Button pattern.

References:
- https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
- https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx
- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- Approved user mock: https://claude.ai/artifact/3e5smaBg8ic6cMDfvnoV3n

Each row owns one `useRowMenu` instance. The trigger click captures that button as the Popover anchor; contextmenu and ArrowDown capture the row. A later outside pointerdown closes an already-open row menu before the next trigger opens, leaving one panel visible.

The action control is borderless and icon-only with a 24px desktop / 28px touch visual box and an 8px pseudo-element hit-area expansion. Touch rows always show the action; hover-capable rows show it on hover, focus-visible within the row, current selection, or while the menu is open. The title reserves the action width and truncates before it.

The menu uses a 168px minimum width, 8px corners, a fine border, the tokenized light `shadow-popover`, and 4px inset. Text-only items use 6px vertical / 8px horizontal spacing and 6px corners. The separator spans the panel. Delete is last and uses `bad` with `bad-soft` on hover/focus. Menu entries remain text-only; icon roles are handled in #54.
