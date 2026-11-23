# ConversationCharacter

- **Use for:** Show decorative status artwork beside descriptive text in the Conversation footer.
- **Do not use for:** Use Message's avatar for senders and StatusMark for a semantic state without artwork.
- **Why:** Inline the existing SVG so only running dots move and reduced-motion preferences apply without altering the artwork.
- **Source:** [Studio Conversation status artwork](../../README.md#conversation-status-artwork)

The running-only hop is transform-only: 1.2s cycle, 150ms stagger, 28/390 of the artwork
height. Preserve shape, color and size.

Styles: style.css in this directory
