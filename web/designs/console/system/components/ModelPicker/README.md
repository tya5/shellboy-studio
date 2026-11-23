# ModelPicker

- **Use for:** Choose a connection/model pair and reasoning effort using the shared controls in Conversation and Settings.
- **Do not use for:** Do not duplicate a Settings picker or attach effort to embedding models. Use SettingRow to frame Settings edits.
- **Why:** One shared list and effort control keep the displayed pair and supported choices consistent; the caller owns scope and saving.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md); [Studio #66](https://github.com/tya5/shellboy-studio/issues/66)

The Conversation header's model picker and run-setting editor. It owns its popover
markup and layout styles; the App screen supplies the model and current details. Use
only in the Conversation header. The picker state and operations remain owned by
`AppModel`.

Styles are colocated in `system/components/ModelPicker/style.css`.

Styles: style.css in this directory


The picker is the shared model/effort interaction for Conversation and Settings: present connection and model together and offer default, low, medium, high, or free-text other effort. Do not duplicate a settings-only picker or infer supported model effort values.

The shared `EffortControl` offers default (unset), low, medium, high, and a free-text other value; it never infers additional levels.

`ModelChooser` owns the trigger and popup placement. `ConnectionModelList` renders searchable `connection / model` entries; the caller supplies its scope and performs the selection. Settings uses the full catalog for default and embedding models. Use with `EffortControl` only for reasoning models; do not attach effort to embedding. Conversation uses the same list and effort control, with its currently selected connection scope.

Conversation uses the same connection/model list and effort control with its existing selected-connection scope and explicit thread save. Settings uses the list across configured connections and writes its selected pair atomically. The effort input can reset to the committed owner value after Settings refuses an edit, even when that value did not change.

The open Conversation picker shares `ConfigEditor` with Settings. Its connection choices come from the loaded owner configuration, refreshed by config marks and resync while the picker is open.

The Conversation trigger lives in the composer and shows connection, model and effort. Open the existing shared list above the composer, not below the viewport edge.
