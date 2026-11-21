# Popover

A portal-rendered, anchored surface for short controls or menus that must escape
row and scroll-container clipping. It stores a separate optional focus-return target
when opened; placement anchor and Escape target need not be the same element. Escape
closes and synchronously restores focus to the captured target; Tab closes and lets
focus move naturally. While open, a transparent full-viewport layer beneath the panel
consumes outside pointerdown, click, and contextmenu events. Outside actions dismiss
the surface without reaching the content underneath.

For row actions, follow the shadcn/ui `DropdownMenu` (Radix) modal dismissal and
panel treatment, plus the WAI-ARIA APG Menu Button focus behavior through shared
`Menu`. Do not use it for settings forms, full dialogs, or a surface that belongs
inside a layout pane.
