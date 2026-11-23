# SectionNav

- **Use for:** Navigate between sections inside a SubView; use grouped search only for long Settings lists.
- **Do not use for:** Use NavItem for top-level routes and PanelTabs for inspector panels. Keep short lists ungrouped.
- **Why:** URL-backed destinations persist selection; narrow layouts retain accessible navigation without sideways page scrolling.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

Use semantic icons and stable search destination IDs. Enter opens the first preselected
result; results reveal their rows and replace the select on phones. Disambiguate repeated
connection fields by connection name.

Styles: style.css in this directory
