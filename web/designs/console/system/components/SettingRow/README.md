# SettingRow

- **Use for:** Show an editable setting in a Section; keep name and explanation beside the control and wrap it below on narrow frames.
- **Do not use for:** Use FactList for read-only facts, DataTable for repeated records and Field for a standalone input.
- **Why:** The consistent control and row-local save placement make settings easy to find and individual changes easy to track.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

Use for editable settings inside a Section card. The name and explanation stay on the left, with the control and row-local save state on the right; controls wrap beneath on narrow frames. Inspired by Orca settings, VS Code settings, and macOS System Settings. Do not use for read-only facts, repeated data tables, or controls without a setting label; keep those in FactList or DataTable.

Styles: style.css in this directory.

A search jump can highlight the row briefly. The outline is static and does not require animation.

Settings search may assign a stable `settingId` (for a row, use its Core key or namespaced preference ID). IDs are not display labels and must not depend on the language.
