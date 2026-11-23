# NavItem

- **Use for:** Navigate to a Studio view with a semantic icon, label and selected state; show a count only for items awaiting a person.
- **Do not use for:** Use PanelTabs to switch within the inspector and Button for actions.
- **Why:** A real link retains its accessible name when the rail hides the visible label.
- **Source:** 出典なし（この Studio で決めた）

A row that moves between views. Supply its semantic `IconRole`, label, current state,
and optional count. The role describes the destination (for example `nav.monitor`);
callers never select a glyph shape. The count uses `wait` and appears only for items
awaiting a person.

In a collapsed desktop rail, the label is hidden visually; the link retains its
accessible name and native tooltip.

Styles: style.css in this directory


In the shell, the icon column is edge-anchored: expanded and collapsed navigation both center existing semantic icons at `size-shell-column / 2` from the left window edge. Preserve each existing IconRole glyph; collapse only hides labels and changes item alignment, not icon identity or styling.
