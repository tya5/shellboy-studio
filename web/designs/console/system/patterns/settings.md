# Settings

Settings are grouped into discoverable sections. Search matches section and setting copy in English and Japanese; opening a result navigates to that section. Sections contain cards, with each editable SettingRow placing its name and explanation beside its control.

Choose an option to save immediately. A connection/model choice writes both keys atomically in one request and Undo restores both keys. Other settings write one key. Text is written on Enter or when leaving the field. The value shown remains the value returned by the next existing config read; pending UI state is limited to the write in flight. Each row says whether the Core result applies now or after the owner restarts. A successful write offers one immediate Undo that writes the previous value through the same operation. Refusal and conflict reasons stay with their row; the UI displays the Core reread, not an optimistic value.

Do not use drafts, multi-field saves, review/diff bands, config caches, polling, manual reload, or per-field reset-to-default actions. Use Section cards for settings controls, and FactList only for read-only facts.

References: Orca settings (`stablyai/orca` at `a6f32d2`, `components/settings`, and `orca.dev/docs/settings`); VS Code settings; macOS System Settings.

A successful write stays pending until a Core config change hint leads to a file hash different from the expected hash. Undo is shown only when the new hash is the write’s own hash; otherwise the row reports a change elsewhere. A hash conflict or other refusal clears pending immediately, displays the reason, and keeps the last published Core values without starting a read or retry. Secret values cannot be put in Undo. Native config invalidation depends on Core #340.

All sections share the same owner snapshot. Settings and the open Conversation model picker share the existing config read. Opening either viewer starts the read if neither was showing it. An owner config mark or resync refreshes it while a viewer is open. An active read is never replaced by another starter; one flag queues a follow-up. The read is canceled only after both viewers close. An expected pre-write hash does not settle a save. The first observed changed hash and the acknowledgment are compared regardless of arrival order; only the currently published saved hash allows Undo; a refusal leaves the last published values in place without starting a read.
