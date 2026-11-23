# ModelPicker

- **Use for:** Choose a connection/model pair and reasoning effort in Conversation and Settings. In Conversation, Enter commits a typed model ID.
- **Do not use for:** Do not duplicate a Settings picker or attach effort to embedding models. Use SettingRow to frame Settings edits.
- **Why:** One shared list and effort control keep the displayed pair and supported choices consistent; the caller owns scope and saving.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md); [Studio #66](https://github.com/tya5/shellboy-studio/issues/66); [Studio #39](https://github.com/tya5/shellboy-studio/issues/39)

The Conversation composer chip shows owner-confirmed connection, model and effort.
Use the existing MonitorPopover for dismissal and the shared searchable
ConnectionModelList and EffortControl. The catalog is scoped to the open picker;
AppModel reads models for configured connections and uses Settings' ConfigEditor
for connection discovery. Selecting a pair sends both fields together. Enter on
search commits the typed ID on the sole matching connection or on the Thread's
current connection if the matches are empty or ambiguous. Effort
presets apply immediately; press Enter to commit Other. The chip and selection
mark follow the existing changed/resync Thread detail readback. The advanced
Thread controls remain in the same panel with their own save action.

Settings also uses the shared model list and effort control. Do not infer
supported effort values, or include effort for embedding models.

Styles: style.css in this directory
