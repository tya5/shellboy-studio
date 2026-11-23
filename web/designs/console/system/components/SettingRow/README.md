# SettingRow

- **Use for:** Show an editable setting in a Section; keep name and explanation beside the control and wrap it below on narrow frames.
- **Do not use for:** Use FactList for read-only facts, DataTable for repeated records and Field for a standalone input.
- **Why:** The consistent control and row-local save placement make settings easy to find and individual changes easy to track.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

A search jump can apply a static highlight. Use a Core key or namespaced preference ID as
`settingId`, not a translated label.

Styles: style.css in this directory
