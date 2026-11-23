# Section

- **Use for:** Use a titled card for one Settings or Analytics subject; name the owner read when showing owner data.
- **Do not use for:** Use ListDivider between repeated rows; don't nest Sections for spacing or combine unrelated subjects.
- **Why:** A card groups editable SettingRows or a FactList without confusing the scope of the heading and actions.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md)

A titled card for one subject on a settings or analytics page. `source` states which owner read the numbers come from; every section that shows owner data has one. `actions` sits at the end of the heading row. Don't nest one Section inside another.

Styles are colocated in `system/components/Section/style.css`.

Styles: style.css in this directory


Section renders the card surface for one subject and contains SettingRows or read-only FactLists. It follows Orca settings, VS Code settings, and macOS System Settings. Do not nest Sections for spacing or use them to group unrelated subjects.

Settings search may assign a stable `settingId` (for a row, use its Core key or namespaced preference ID). IDs are not display labels and must not depend on the language.
