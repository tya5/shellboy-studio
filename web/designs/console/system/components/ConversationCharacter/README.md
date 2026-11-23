# ConversationCharacter

- **Use for:** Show decorative status artwork beside descriptive text in the Conversation footer.
- **Do not use for:** Use Message's avatar for senders and StatusMark for a semantic state without artwork.
- **Why:** Inline the existing SVG so only running dots move and reduced-motion preferences apply without altering the artwork.
- **Source:** [Studio Conversation status artwork](../../README.md#conversation-status-artwork)

Decorative artwork for the conversation status footer, always paired with state text. Use Message's avatar for message senders instead.

The thinking artwork is inlined from the existing tracked SVG, not redrawn. That lets the parent document's motion preference reliably control the three dots. Only running uses a transform-only hop (chat typing pattern): 1.2s cycle, 150ms stagger, 28/390 of the artwork height. Waiting and reduced-motion views keep the same dots still. No shape, color, or size changes.

Styles: style.css in this directory
