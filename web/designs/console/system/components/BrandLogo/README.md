# BrandLogo

Decorative approved silhouette at the existing sidebar brand position; adjacent
text supplies the accessible name. Inline SVG reads the existing generated
accent/logo-face/logo-bright CSS tokens. Light and Console (dark) use their
explicit palettes; Auto selects their existing palettes through the same OS
media query as the adaptive favicon. The inline mark stays mounted and recolors
with its background; it does not fetch or swap artwork. Do not use an image URL for the in-app
logo: external SVG cannot inherit the selected app theme. OS-dependent browser
favicon and fixed light-accent install icons have separate asset roles.

Styles: style.css in this directory

In the fixed shell header, render the mark at `size-brand-mark` (24px). Keep it a brand asset, not a navigation icon.
