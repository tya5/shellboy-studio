# SubView

- **Use for:** Frame a view with independently read sections, such as Settings and Analytics; use grouped search only for a long list.
- **Do not use for:** Use Section for one subject and PanelTabs for Conversation inspector sections.
- **Why:** URL-backed panes preserve the current section, and the page heading stays visible when phone navigation collapses to a selector.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

A dedicated view may supply a close destination for its breadcrumb and Escape action; omit it
for embedded and analytics views. Search highlights a stable `data-setting-id`, not translated
text.

Styles: style.css in this directory
