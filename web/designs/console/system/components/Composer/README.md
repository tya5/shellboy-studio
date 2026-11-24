# Composer

- **Use for:** Send a Thread message, target a running shell with its matching EOF action, choose model delivery timing, interrupt a Turn, or Stop an active Run; keep the model picker and context disclosure in the composer action row.
- **Do not use for:** Use QuestionCard to answer a specific pending question; keep model and context controls out of ConversationHeader.
- **Why:** Enter sends, Shift+Enter inserts a line, IME conversion never sends, and the draft stays until the owner accepts it.
- **Source:** [Studio #66: composer control placement](https://github.com/tya5/shellboy-studio/issues/66)

The message box with a target chip and model-delivery row, Send, and while active Interrupt Turn and Stop. The target defaults to Model; running shells are ordered with the current Turn’s foreground shell first. Shell input preserves whitespace and EOF stays on the selected target chip. Enter sends, Shift+Enter makes a new line, and Enter during IME conversion never sends. The text stays until the owner accepts it. Unsent drafts stay with their Thread
and are restored when you return to it.

`ComposerRouting` owns target/timing controls and their classes. Place it immediately above the text area, with EOF inside the selected shell chip. Model sends expose Next boundary and Now; shell targets disable timing.

Styles are colocated in `system/components/Composer/style.css`.

Styles: style.css in this directory

Design system v2 control row: one line in every state and width. Start: the model control as a ghost button (connection and model in `type-code`, effort in `type-label` `muted`), then the hint in `type-caption` `muted`. End: ContextRing (ghost), Stop only while a Run is active, then Send (`primary`, always last). When space runs out the hint truncates first, then the model name; at phone width the hint is hidden. Long running status stays in the conversation status line above the composer. The text area starts two rows high.

Composer puts the model/effort chooser at the start of the action row and the context disclosure beside send and stop. Keep these controls out of the conversation header.
