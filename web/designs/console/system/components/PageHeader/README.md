# PageHeader

- **Use for:** The top of a page or SubView pane: its one title-role heading, an optional one-line description, page actions at the end of the title row, and an optional toolbar row (search field with a leading icon, ButtonGroup choices, ghost Buttons, then the result count).
- **Do not use for:** Use the application header (top bar) for the breadcrumb and window-level actions, Section for a subject inside the page, and SettingRow for one setting. A SubView pane never adds a second title: the view's own name lives in the header breadcrumb.
- **Why:** Design system v2 structure levels: one page title per page, aligned to the page perimeter, with actions and filters in fixed places so every page reads the same way.
- **Source:** [WAI-ARIA APG Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/), [Material 3 Top app bar (medium and large)](https://m3.material.io/components/top-app-bar/overview), [Apple HIG Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)

- Title `type-title` in `fg` (`type-heading` at phone width), description `type-body` in `muted`, `space-4` apart. Page actions sit at the end of the title row and wrap under the title when narrow.
- The toolbar is `space-12` below the title block; controls are `space-8` apart; a search Field grows to fill the row; `count` is the trailing result count in `type-caption` `muted`. The content below starts `space-16` after the header (the page column's gap).
- The left edge is the page perimeter supplied by the page column (`space-24` desktop, `space-12` phone); PageHeader adds no padding of its own.
- Pass `toolbarLabel` when the toolbar holds three or more controls: it becomes a `role="toolbar"` with one Tab stop and arrow, Home and End keys between its controls; a text field keeps its own arrow keys.
- Actions follow action strength: ghost for most, one primary at most. Choices are ButtonGroup; two groups in the toolbar are wrapped in `.choice-row`.

Styles: style.css in this directory
