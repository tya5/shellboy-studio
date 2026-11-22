# ConversationCharacter

Decorative artwork for the conversation status footer, always paired with state text. Use Message's avatar for message senders instead.

The thinking artwork is inlined from the existing tracked SVG, not redrawn. That lets the parent document's motion preference reliably control the three dots. Only running uses a transform-only hop (chat typing pattern): 1.2s cycle, 150ms stagger, 28/390 of the artwork height. Waiting and reduced-motion views keep the same dots still. No shape, color, or size changes.

Styles: style.css in this directory
