# Popover

A portal-rendered, anchored surface for short controls or menus that must escape
row and scroll-container clipping. It captures the opener once when opened. Escape
closes and synchronously restores focus to that opener; Tab closes and lets focus
move naturally; outside pointerdown closes without moving focus. For row actions,
follow the shadcn/ui `DropdownMenu` panel treatment and WAI-ARIA APG Menu Button
focus behavior through the shared `Menu`. Do not use it for settings forms, full
dialogs, or a surface that belongs inside a layout pane.
