# NavItem

- **Use for:** Navigate to a Studio view with a semantic icon, label and selected state; show a count only for items awaiting a person.
- **Do not use for:** Use PanelTabs to switch within the inspector and Button for actions.
- **Why:** A real link retains its accessible name when the rail hides the visible label.
- **Source:** 出典なし（この Studio で決めた）

Retain the accessible name and native tooltip in the rail, and center both layouts at
`size-shell-column / 2` from the left edge. Keep the same IconRole glyph.

Styles: style.css in this directory
