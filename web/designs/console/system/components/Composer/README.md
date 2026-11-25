# Composer

- **Use for:** Compose a text message to the model, choose the model in the action row, and send; show Stop model only while the model is working.
- **Do not use for:** Shell stdin input and delivery-mode controls are not part of the Studio composer. Use the Thread panel for shell background and stop actions.
- **Why:** Drafts contain text only and remain scoped to their Thread. Every Send uses the model's default next-safe-boundary delivery; the owner-confirmed reservation and acceptance path controls when text clears.
- **Source:** Studio #160 stop-controls decision, based on the established Composer action-row contract (#66).

The composer contains a two-row text area and one action row: model picker and concise status hint at the start; context, optional Stop model, and Send at the end. Do not add a destination row, delivery-timing row, shell placeholder, or EOF action. Keep the model picker in the composer, not the conversation header. Enter sends, Shift+Enter inserts a newline, and IME conversion never sends. The draft is bounded per Thread and stores only text. The composer uses `AppModel.send`, which always requests default (`next`) delivery.

Styles are colocated in `style.css`.

Styles: style.css in this directory.
