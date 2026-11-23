# FactList

- **Use for:** Show read-only facts with a label and value; use `mono` for machine values and explicit missing wording where the owner has no read.
- **Do not use for:** Use SettingRow for editable settings and DataTable for comparing repeated records.
- **Why:** A compact definition list can omit inapplicable rows and carry notes without suggesting an editable or guessed value.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

For Settings search, use a Core key or namespaced preference ID as `settingId`, never a
translated label.

Styles: style.css in this directory
