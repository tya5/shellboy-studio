# SubView

- **Use for:** Frame a view with independently read sections, such as Settings and Analytics; use grouped search only for a long list.
- **Do not use for:** Use Section for one subject and PanelTabs for Conversation inspector sections.
- **Why:** URL-backed panes preserve the current section, and the page heading stays visible when phone navigation collapses to a selector.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

The frame for a view split into sections, used by Settings and Analytics. Prefer panes to one long scroll when a view holds subjects read separately. Keep the selected section in the URL hash and read a section's data only when it opens. Each pane starts with a `pagehead`, so the section's name stays visible when the list collapses to a selector on a phone.

Styles: style.css in this directory


SubView supports optional grouped navigation and local search while preserving the existing ungrouped mode used by Analytics. Inspired by Orca, VS Code, and macOS System Settings. Use grouped search when a section list is long; do not add it to a small, already-scannable navigation.

The optional close destination adds a breadcrumb and an Escape action to a dedicated view. Omit it in embedded and analytics views. Styles live in `style.css`.

Search highlights the destination with a matching `data-setting-id` instead of matching translated text.
