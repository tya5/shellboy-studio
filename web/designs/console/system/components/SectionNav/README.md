# SectionNav

- **Use for:** Navigate between sections inside a SubView; use grouped search only for long Settings lists.
- **Do not use for:** Use NavItem for top-level routes and PanelTabs for inspector panels. Keep short lists ungrouped.
- **Why:** URL-backed destinations persist selection; narrow layouts retain accessible navigation without sideways page scrolling.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

The sections inside one view, such as Settings or Analytics. Use it through SubView.
Each item supplies a semantic `IconRole` for its destination, not a glyph name. The
section location stays in the URL hash. At narrow widths the links wrap into rows
of tabs, at least 44px high, so every section stays visible and nothing scrolls
sideways.

Styles are colocated in `system/components/SectionNav/style.css`.

Styles: style.css in this directory

Grouped navigation and search can be enabled by SubView for a long section list; Analytics leaves both disabled. Settings uses visible localized names and descriptions, then a compact select at phone width. References: Orca settings, VS Code settings, and macOS System Settings. Do not use grouped search for short lists.

The first search result is preselected and Enter opens it. Setting results reveal their destination row; on phones the results replace the section select.

Search rows supply a destination ID independent of the localized label; repeated connection fields include the connection name in result copy.
