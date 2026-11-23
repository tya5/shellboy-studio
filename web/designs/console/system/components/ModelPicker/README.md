# ModelPicker

- **Use for:** Choose a connection/model pair and reasoning effort using the shared controls in Conversation and Settings.
- **Do not use for:** Do not duplicate a Settings picker or attach effort to embedding models. Use SettingRow to frame Settings edits.
- **Why:** One shared list and effort control keep the displayed pair and supported choices consistent; the caller owns scope and saving.
- **Source:** [Studio Settings pattern (Orca, VS Code, macOS)](../../patterns/settings.md); [Studio #66](https://github.com/tya5/shellboy-studio/issues/66)

Use default (unset), low, medium, high or free-text other; never infer effort options.
Settings uses the full catalog and writes the pair atomically; Conversation uses its
selected-connection scope and explicit save, with the popup above the composer. The open
picker shares ConfigEditor reads and hint handling with Settings.

Styles: style.css in this directory
