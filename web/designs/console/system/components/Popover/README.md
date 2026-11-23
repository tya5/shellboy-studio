# Popover

- **Use for:** Anchor short controls or menus above clipping boundaries with independent placement and focus return.
- **Do not use for:** Use ThreadDeleteDialog or WorkSheet for modal flows and Section for forms that belong in a pane.
- **Why:** A portal escapes clipping; its outside layer dismisses without activating underlying controls.
- **Source:** [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Escape restores the captured focus target; Tab closes without moving focus itself. Outside
pointerdown is consumed, then click/auxclick/contextmenu dismisses. A pointer-coordinate
anchor can shift at a viewport collision.

Styles: style.css in this directory
