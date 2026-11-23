# ShellToggle

- **Use for:** Show or hide a desktop shell panel from its `size-shell-footer` footer, or open the phone right panel from its `size-touch` footer, with `aria-expanded` and an action label.
- **Do not use for:** Use LayoutSeparator to resize, and the phone menu button for the drawer. Do not move the toggle into the header.
- **Why:** A fixed edge anchor and filled/outline side strip communicate state without color or a moving target.
- **Source:** [Studio shell panels (VS Code, Orca, GitHub)](../../README.md#shell-panels)

The reusable shell footer row and stable control for showing and hiding one shell panel. Use within a `ShellFooter` row of height `size-shell-footer` (36px) on desktop or `size-touch` (44px) for the phone right panel; report state with `aria-expanded`, an action label and optional keyboard shortcut in `title`. The side strip is filled while its panel is shown and outline-only while hidden; color never indicates state.

Place sidebar toggles on the navigation icon column and panel toggles on the panel rail icon column. The right panel footer reserves its flex-growing middle even while collapsed, keeping the footer at the bottom; both states share the same zero-inset bottom anchor. Mirror the VS Code side strip for the right panel control. Both columns use `size-shell-column`; keep their screen-edge anchors fixed across expanded and rail layouts. Do not place this control in a header or use it for the phone drawer (which remains the mobile menu button).

References: VS Code `layoutSidebarLeft` / `layoutSidebarLeftOff`, Orca `SidebarToggleIcon`, and GitHub sidebar footer disclosure.


Styles: style.css in this directory
