# ConversationCharacter

- **Use for:** Show decorative status artwork beside descriptive text in the Conversation footer.
- **Do not use for:** Use Message's avatar for senders and StatusMark for a semantic state without artwork.
- **Why:** Keep the existing artwork and staggered hops, with each dot animated by its own HTML wrapper rather than an SVG root.
- **Source:** [Studio Conversation status artwork](../../README.md#conversation-status-artwork)

Decorative artwork for the conversation status footer, always paired with state text. Use Message's avatar for message senders instead.

The thinking artwork comes from the tracked SVG. Its three dots remain in separate, overlaid SVGs, each inside a same-size HTML wrapper. The parent owns the running state and the wrappers animate without duplicate state attributes (Studio #144; compositor-friendly transform pattern from the web.dev Animations guide). Running keeps the 1.2s hop and 150ms stagger; `will-change` is applied only under no-preference motion. Waiting and reduced-motion views keep the dots still.

Styles: style.css in this directory
