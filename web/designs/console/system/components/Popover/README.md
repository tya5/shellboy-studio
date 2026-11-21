# Popover

A portal-rendered, anchored surface for short controls or menus that must escape
row and scroll-container clipping. It stores a separate optional focus-return target
when opened; placement anchor and Escape target need not be the same element. Escape
closes and synchronously restores focus to that target; Tab closes and lets focus
move naturally; outside pointerdown closes without moving focus. For row actions,
follow the shadcn/ui `DropdownMenu` panel treatment and WAI-ARIA APG Menu Button
focus behavior through the shared `Menu`. Do not use it for settings forms, full
dialogs, or a surface that belongs inside a layout pane.
