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

On hover-capable devices, show the borderless ghost trigger for row hover,
`:focus-within`, current selection, or an open menu. Touch always shows it. The
32px/44px row and 24px/28px action boxes reserve their action width so titles truncate
in place. The menu uses 168px minimum width, 8px corners, a fine border, the
tokenized `shadow-popover`, and 4px inset. Items pair an optional semantic IconRole (16px muted icon) with
text; once any item has an icon or a check, every item reserves the icon column so labels share one left edge (design system v2), using 6px vertical / 8px horizontal spacing and 6px corners. Glyph names and the role-to-glyph map stay module-private inside `Icon`; only semantic roles are exposed. The separator spans the panel; Delete is last
and uses `bad` with `bad-soft` on hover/focus.

On touch, the visible trigger is the primary path. Long press opens the menu only
where the browser emits `contextmenu`; no custom long-press handler is used.

The shared `threadMenuEntries` definition takes the Thread's row and gates Stop and Retry on its owner activity, never on the merged attention mark: Stop for any live Run (running, waiting or recovery), Retry for recovery only. Both read `thread.get` for the `run_id` when pressed; when there is none, or the read fails, the error names that reason. It assigns the semantic `action.editTags` tag icon, so every Thread row menu presents Edit tags with the same icon and dimensions. Consumers do not provide per-item icon overrides.
