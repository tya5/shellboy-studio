# MoreMenu

- **Use for:** Disclose secondary phone navigation links after their trigger in DOM order.
- **Do not use for:** Use PanelTabs for local panels and Menu for actions, not route links.
- **Why:** Native links keep navigation semantics; Escape restores trigger focus and leaving the disclosure closes it.
- **Source:** [WAI-ARIA APG Disclosure Navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/); [Studio Radix focus audit](https://github.com/tya5/shellboy-studio/commit/59351a065803778b3cf9aa55a38cdbade295dc3a)

The phone navigation disclosure. Keep its button before the conditional links in DOM
order so Tab visits the disclosure control before the links. `aria-controls` points
to the panel. Escape and focus leaving the whole disclosure close it; Escape restores
focus to the trigger. A link selection closes the panel. Items use semantic destination
`IconRole` values; the views remain navigation links rather than tab widgets.

References: WAI-ARIA APG Disclosure Navigation example and Radix
`navigation-menu:1028` for close-on-focus-leave behavior.

Styles: style.css in this directory
