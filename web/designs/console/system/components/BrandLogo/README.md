# BrandLogo

- **Use for:** Render the approved decorative inline mark in the shell/sidebar and phone Thread drawer, paired with an accessible name from adjacent text.
- **Do not use for:** Use Icon for navigation; keep browser favicon and install assets separate. Do not substitute an external SVG URL for the in-app mark.
- **Why:** Inline SVG inherits the resolved theme tokens, including Auto, without swapping artwork. Use `size-brand-mark` in the fixed shell header.
- **Source:** [Studio brand surfaces and theme ownership](../../README.md#brand-surfaces-and-theme-ownership)

Decorative approved silhouette at the existing sidebar brand position; adjacent
text supplies the accessible name. Inline SVG reads the existing generated
accent/logo-face/logo-bright CSS tokens. Light and Console (dark) use their
explicit palettes; Auto selects their existing palettes through the same OS
media query as the adaptive favicon. The inline mark stays mounted and recolors
with its background; it does not fetch or swap artwork. Do not use an image URL for the in-app
logo: external SVG cannot inherit the selected app theme. OS-dependent browser
favicon and fixed light-accent install icons have separate asset roles.

Styles: style.css in this directory

In the fixed shell header, render the mark at `size-brand-mark` (24px). Keep it a brand asset, not a navigation icon. Align its left edge to the collapsed rail position in both sidebar states; the brand label may move independently.
