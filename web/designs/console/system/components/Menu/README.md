# Menu

- **Use for:** Short actions opened from a ghost trigger through Popover, with semantic entry icons, toggle items (`checked`) for filters, and separators between distinct groups.
- **Do not use for:** Use MoreMenu or a link for navigation (a route such as Branches never sits among actions), SettingRow in a Section for forms, and ThreadDeleteDialog for singleton deletion confirmation.
- **Why:** Menu provides keyboard traversal, typeahead and focus return; the caller, not Menu, owns action policy. Design system v2: one icon column for every item keeps all labels on one left edge, and a check shows a toggle's state.
- **Source:** [Radix Dropdown Menu (CheckboxItem, ItemIndicator)](https://www.radix-ui.com/primitives/docs/components/dropdown-menu), [WAI-ARIA APG Menu and Menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/), [Studio row actions](../../patterns/row-actions.md)

A compact WAI-ARIA menu of short actions opened through `Popover`. Consumers choose
optional item icons by semantic `IconRole` (for example `action.archive`), never by
glyph shape. The active theme owns the role-to-glyph mapping. Menu entries use `<Icon size="menu">`, which maps to the dedicated 16px icon token; other small icons use `size="small"` (15px).

- Pointer opening focuses the menu panel, not its first entry; keyboard opening
  (ArrowDown, Enter, or Space on the trigger) moves focus to the first enabled item.
- Selection closes the menu and restores focus to its trigger. Escape closes and
  restores the captured focus target; Tab closes and lets focus move naturally.
- ArrowUp/ArrowDown stop at the ends (Radix default `loop=false`); Home/PageUp and
  End/PageDown jump to the first and last enabled item. Printable characters use
  typeahead. Enter/Space activate the focused entry.
- `aria-labelledby` ties the menu to its trigger; the trigger's `aria-controls`
  identifies the menu.
- The modal Popover layer consumes outside pointerdown; its click, auxclick, or
  contextmenu dismisses without activating underlying content.

A selected item's callback is action-only; the owning screen computes any confirmation
target/next-row context from its current list. Menu does not infer delete focus targets
from its Escape return target. Use separators between distinct action groups.
Disabled entries are omitted by application policy. Do not put settings forms or long data-entry controls in a menu.

References (Radix source lines from the Reviewer audit): `dropdown-menu:119,188`
(trigger/menu ID association), `dropdown-menu:192` (focus return), `menu:531`
(keyboard-only entry focus), `menu:390,583` (non-looping movement, Page keys and
typeahead); APG Menu Button and Menu patterns.

Styles are colocated in `system/components/Menu/style.css`.

Styles: style.css in this directory

A paging item may keep the menu open. Selection and mutation items dismiss normally.

When live entries change, focus stays on the current item if it survives, or moves to the nearest surviving item (the menu panel if there are none).

## Icon and check column (design system v2)

- When any item has an `icon` or a `checked` value, every item gets a `size-icon-menu` column (`space-8` to its label), empty where the item has no icon. Labels then share one left edge. Give every action item a semantic icon where one exists, for example `action.editTags` for Edit tags.
- An item with `checked` is a `menuitemcheckbox` with `aria-checked`; when true, its column shows the `menu.checked` mark in `fg`. Use it for filter toggles such as Awaiting you and Include archived.
- The panel is `panel` (not `raised`), so the `hover` surface of the item under the pointer or keyboard focus is visible. Corners `radius-m`, `shadow-popover`, minimum width `size-menu-min`. Items are `size-control` high with `space-6` / `space-8` padding and `radius-s`; destructive items use `bad` and `bad-soft`.
- The trigger is a ghost icon Button with `aria-haspopup="menu"`, which keeps its `hover` surface while the menu is open.
