# ModelPicker

The Conversation header's model picker and run-setting editor. It owns its popover
markup and layout styles; the App screen supplies the model and current details. Use
only in the Conversation header. The picker state and operations remain owned by
`AppModel`.

Styles are colocated in `system/components/ModelPicker/style.css`.

Styles: style.css in this directory


The picker is the shared model/effort interaction for Conversation and Settings: present connection and model together and offer default, low, medium, high, or free-text other effort. Do not duplicate a settings-only picker or infer supported model effort values.

The shared `EffortControl` offers default (unset), low, medium, high, and a free-text other value; it never infers additional levels.
