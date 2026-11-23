# AppFrame

- **Use for:** Host an open app in a sandboxed iframe without `allow-same-origin`; keep it mounted but hidden when inactive.
- **Do not use for:** Use AppCard for library entries and native Studio views for Studio-owned content.
- **Why:** An opaque origin isolates the app from Studio's cookie, storage and DOM without requiring a second port. The app opts into Studio CSS itself.
- **Source:** [Studio Apps design](../../../../../../docs/design/apps.md)

The opt-in stylesheet is `/_shellboy/ui.css`.

Styles: style.css in this directory
