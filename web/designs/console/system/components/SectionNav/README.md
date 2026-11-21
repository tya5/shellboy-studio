The sections inside one view, such as Settings or Analytics. Use it through SubView.
Each item supplies a semantic `IconRole` for its destination, not a glyph name. The
section location stays in the URL hash. At narrow widths the links wrap into rows
of tabs, at least 44px high, so every section stays visible and nothing scrolls
sideways.

Styles are colocated in `system/components/SectionNav/style.css`.

Styles: style.css in this directory

Grouped navigation and search can be enabled by SubView for a long section list; Analytics leaves both disabled. Settings uses visible localized names and descriptions, then a compact select at phone width. References: Orca settings, VS Code settings, and macOS System Settings. Do not use grouped search for short lists.
