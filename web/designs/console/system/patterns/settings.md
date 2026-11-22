# Settings

Settings are grouped into discoverable sections. Search matches section and setting copy in English and Japanese; opening a result navigates to that section. Sections contain cards, with each editable SettingRow placing its name and explanation beside its control.

Choose an option to save immediately. A connection/model choice writes both keys atomically in one request and Undo restores both keys. Other settings write one key. Text is written on Enter or when leaving the field. The value shown remains the value returned by the next existing config read; pending UI state is limited to the write in flight. Each row says whether the Core result applies now or after the owner restarts. A successful write offers one immediate Undo that writes the previous value through the same operation. Refusal and conflict reasons stay with their row; the UI displays the Core reread, not an optimistic value.

Do not use drafts, multi-field saves, review/diff bands, config caches, polling, manual reload, or per-field reset-to-default actions. Use Section cards for settings controls, and FactList only for read-only facts.

References: Orca settings (`stablyai/orca` at `a6f32d2`, `components/settings`, and `orca.dev/docs/settings`); VS Code settings; macOS System Settings.
