# SettingRow

- **Use for:** Use always-editable rows in left owner Settings, where changing values is the purpose. Use the read view and visible Change action in right Thread Settings, where reading is the common case. Swap only that row to its editor; Cancel and Escape return to Change.
- **Do not use for:** Use FactList for read-only facts, DataTable for repeated records, and Field for a standalone input.
- **Why:** Keep names and controls consistent while prioritizing readable values on the Thread surface and ready-to-use inputs on the owner surface.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md); [Studio #80 row decision (Atlassian Inline edit, GOV.UK Summary list, Open WebUI Chat Controls)](https://github.com/tya5/shellboy-studio/issues/80#issuecomment-7092835723).

A search jump can apply a static highlight. Use a Core key or namespaced preference ID as `settingId`, not a translated label.

Styles: style.css in this directory
