# VirtualSpace and VirtualGap

- **Use for:** Position measured conversation rows in total scroll space; use VirtualGap with LoadingRows for a not-yet-loaded span.
- **Do not use for:** Use an ordinary list for a short fully rendered view; don't use these layout primitives as loading state owners.
- **Why:** Pixel offsets reflect the scroller's measured arithmetic while estimates cover only unmeasured heights.
- **Source:** [Studio measured scroll space](../../../../../../docs/design/conversation-scroll.md#scroll-space-and-ownership)

Used by the long-thread reader. `VirtualSpace` is a block as tall as all rows together (measured heights plus an estimate for unmeasured ones) and places the rows being drawn at their offset inside it. `VirtualGap` stands in for a run of rows not read yet, at their estimated height, holding LoadingRows. Neither draws anything itself, and neither has a state, colour or motion. Heights are given in pixels because the scroller's arithmetic is in pixels; use no other component for this.

Styles are colocated in `system/components/VirtualSpace/style.css`.

Styles: style.css in this directory
