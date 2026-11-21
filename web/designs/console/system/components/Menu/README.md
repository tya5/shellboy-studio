# Menu

A compact WAI-ARIA menu of short actions opened from a button through `Popover`.
Follow shadcn/ui `DropdownMenu` (Radix) and the WAI-ARIA APG Menu pattern: focus
the first item on open, support arrow/home/end movement, close on Escape/Tab, and
keep destructive actions last. The modal Popover layer consumes outside
pointerdown/click/contextmenu and only dismisses the menu; it never activates the
underlying content. Use separators between distinct action groups. Disabled entries
are omitted. Do not put settings forms or long data-entry controls in a menu.
