# Menu

- **Use for:** Open short actions via Popover; use semantic entry icons and dividers between distinct groups.
- **Do not use for:** Use SettingRow in a Section for forms and ThreadDeleteDialog for singleton deletion confirmation.
- **Why:** Menu provides keyboard traversal, typeahead and focus return; the caller, not Menu, owns action policy.
- **Source:** [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Pointer opening focuses the panel; keyboard opening focuses the first enabled entry. Omit
policy-disabled entries. Paging may keep the menu open. If live entries change, retain focus
on the surviving item, its nearest neighbor, or the panel when empty.

Styles: style.css in this directory
