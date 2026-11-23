# FactList

- **Use for:** Show read-only facts with a label and value; use `mono` for machine values and explicit missing wording where the owner has no read.
- **Do not use for:** Use SettingRow for editable settings and DataTable for comparing repeated records.
- **Why:** A compact definition list can omit inapplicable rows and carry notes without suggesting an editable or guessed value.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

Read-only settings and resource values, label beside value. Machine values use `mono`. A value the owner has no read for shows the `missing` wording and never a dash, a guess, a default or a placeholder input. `control` is where an edit control attaches when an owner operation exists. It stacks at phone width. Unlike KeyValue, its rows may be absent on purpose and it has room for a note.

Styles are colocated in `system/components/FactList/style.css`.

Styles: style.css in this directory


Editable facts now delegate to SettingRow; read-only facts retain the compact definition-list layout. Use SettingRow for setting interactions, not for factual metadata.

Settings search may assign a stable `settingId` (for a row, use its Core key or namespaced preference ID). IDs are not display labels and must not depend on the language.
