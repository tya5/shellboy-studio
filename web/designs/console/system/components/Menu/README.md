# Menu

A compact WAI-ARIA menu of short actions opened through `Popover`. Follow Radix
`dropdown-menu`/`menu` and the APG Menu Button/Menu pattern:

- Pointer opening focuses the menu panel, not its first entry; keyboard opening
  (ArrowDown) moves focus to the first enabled item.
- Selection closes the menu and restores focus to its trigger. Escape closes and
  restores the captured focus target; Tab closes and lets focus move naturally.
- ArrowUp/ArrowDown stop at the ends (Radix default `loop=false`); Home/PageUp and
  End/PageDown jump to the first and last enabled item. Printable characters use
  typeahead. Enter/Space activate the focused entry.
- `aria-labelledby` ties the menu to its trigger; the trigger's `aria-controls`
  identifies the menu.
- The modal Popover layer consumes outside pointerdown; its click, auxclick, or
  contextmenu dismisses without activating underlying content.

Use separators between distinct action groups. Disabled entries are omitted by
application policy. Do not put settings forms or long data-entry controls in a menu.

References (Radix source lines from the Reviewer audit): `dropdown-menu:119,188`
(trigger/menu ID association), `dropdown-menu:192` (focus return), `menu:531`
(keyboard-only entry focus), `menu:390,583` (non-looping movement, Page keys and
typeahead); APG Menu Button and Menu patterns.
