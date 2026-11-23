# ShellToggle

- **Use for:** Show or hide one desktop shell panel from its fixed 36px footer, with `aria-expanded` and an action label.
- **Do not use for:** Use LayoutSeparator to resize, and the phone menu button for the drawer. Do not move the toggle into the header.
- **Why:** A fixed edge anchor and filled/outline side strip communicate state without color or a moving target.
- **Source:** [Studio shell panels (VS Code, Orca, GitHub)](../../README.md#shell-panels)

Anchor both icon columns at `size-shell-column` and keep the footer at the bottom even when
content is hidden. Mirror the side strip for the right panel; put an optional shortcut in
`title`.

Styles: style.css in this directory
