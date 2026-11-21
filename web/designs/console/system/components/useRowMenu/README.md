# useRowMenu

Each row keeps local open and placement-anchor state. Opening the trigger stores its
button as the anchor; contextmenu and ArrowDown store the row. A second menu opens
after the existing Popover's outside-pointer dismissal, matching Radix DropdownMenu;
no shared registry or dismissal-order workaround is needed. On open, it stores the
currently focused element as Escape's focus-return target. This follows the shadcn/ui
`SidebarMenuAction` and the WAI-ARIA APG Menu Button pattern.
