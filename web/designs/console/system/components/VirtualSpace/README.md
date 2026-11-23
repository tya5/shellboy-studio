# VirtualSpace and VirtualGap

- **Use for:** Position measured conversation rows in total scroll space; use VirtualGap with LoadingRows for a not-yet-loaded span.
- **Do not use for:** Use an ordinary list for a short fully rendered view; don't use these layout primitives as loading state owners.
- **Why:** Pixel offsets reflect the scroller's measured arithmetic while estimates cover only unmeasured heights.
- **Source:** [Studio measured scroll space](../../../../../../docs/design/conversation-scroll.md#scroll-space-and-ownership)

Styles: style.css in this directory
