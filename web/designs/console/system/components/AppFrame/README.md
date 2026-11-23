# AppFrame

- **Use for:** Host an open app in a sandboxed iframe without `allow-same-origin`; keep it mounted but hidden when inactive.
- **Do not use for:** Use AppCard for library entries and native Studio views for Studio-owned content.
- **Why:** An opaque origin isolates the app from Studio's cookie, storage and DOM without requiring a second port. The app opts into Studio CSS itself.
- **Source:** [Studio Apps design](../../../../../../docs/design/apps.md)

Hosts an app's page in a sandboxed iframe without `allow-same-origin`, so the page has an opaque origin: it can't reach the Web UI's cookie, storage or DOM, even on the same port. It is hidden, never removed, while another tab shows. The page is the app author's: nothing from the design system reaches inside unless the app loads `/_shellboy/ui.css`.

Styles are colocated in `system/components/AppFrame/style.css`.

Styles: style.css in this directory
