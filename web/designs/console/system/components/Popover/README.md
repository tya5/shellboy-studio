# Popover

A portal-rendered anchored surface for short controls or menus that must escape row
and scroll-container clipping. It stores a separate optional focus-return target
when opened; placement anchor and Escape target need not be the same element. Escape
closes and synchronously restores the captured focus target; Tab closes and lets
focus move naturally. While open, the transparent viewport layer consumes outside
pointerdown and closes on click, auxclick, or contextmenu without activating the page.

For Menu, pointer opening focuses the panel and keyboard opening focuses the first
entry. Selecting an entry returns focus to the menu trigger. Context menus may pass
a pointer coordinate as the placement origin with side-right/align-start placement,
shifting to the viewport gutter on collision. This follows Radix ContextMenu
`context-menu:254,256` and Popper alignment-axis shift `popper:244`, plus Radix
`dropdown-menu` modal dismissal and WAI-ARIA APG Menu Button focus behavior.

Do not use this for dialogs, settings forms, or a surface that belongs inside a pane.
