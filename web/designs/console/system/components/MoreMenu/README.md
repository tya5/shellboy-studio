# MoreMenu

- **Use for:** Disclose secondary phone navigation links after their trigger in DOM order.
- **Do not use for:** Use PanelTabs for local panels and Menu for actions, not route links.
- **Why:** Native links keep navigation semantics; Escape restores trigger focus and leaving the disclosure closes it.
- **Source:** [WAI-ARIA APG Disclosure Navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/); [Studio Radix focus audit](https://github.com/tya5/shellboy-studio/commit/59351a065803778b3cf9aa55a38cdbade295dc3a)

Keep the trigger before the conditional links and link it with `aria-controls`.

Styles: style.css in this directory
