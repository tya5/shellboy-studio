# ModelPicker

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


When a notice requests focus on the Thread output-limit override, the picker consumes
`AppModel.pendingSettingFocus` after its panel mounts and clears it only after the
field receives focus. Do not schedule focus from the caller with a timer.
