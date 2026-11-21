# MoreMenu

The phone navigation disclosure. Keep its button before the conditional links in DOM
order so Tab visits the disclosure control before the links. `aria-controls` points
to the panel. Escape and focus leaving the whole disclosure close it; Escape restores
focus to the trigger. A link selection closes the panel. Items use semantic destination
`IconRole` values; the views remain navigation links rather than tab widgets.

References: WAI-ARIA APG Disclosure Navigation example and Radix
`navigation-menu:1028` for close-on-focus-leave behavior.

Styles: style.css in this directory
