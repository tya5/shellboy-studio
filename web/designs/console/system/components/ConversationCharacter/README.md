# ConversationCharacter

- **Use for:** Show decorative status artwork beside descriptive text in the Conversation footer.
- **Do not use for:** Use Message's avatar for senders and StatusMark for a semantic state without artwork.
- **Why:** Keep the existing artwork and animate only the separate SVG roots for the dots.
- **Source:** [Studio Conversation status artwork](../../README.md#conversation-status-artwork)

Decorative artwork for the conversation status footer, always paired with state text. Use Message's avatar for message senders instead.

The thinking artwork comes from the tracked SVG. Its three dots sit in separate, overlaid SVG roots. Running keeps the 1.2s hop and 150ms stagger without animating shapes inside an SVG. Waiting and reduced-motion views keep the dots still.

Styles: style.css in this directory
