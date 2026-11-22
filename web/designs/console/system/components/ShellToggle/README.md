# ShellToggle

The reusable shell footer row and stable control for showing and hiding one shell panel. Use within a 36px `ShellFooter` row; report state with `aria-expanded`, an action label and optional keyboard shortcut in `title`. The side strip is filled while its panel is shown and outline-only while hidden; color never indicates state.

Place sidebar toggles on the navigation icon column and panel toggles on the panel rail icon column. The right panel footer reserves its flex-growing middle even while collapsed, keeping the footer at the bottom; expanded state retains the panel bottom inset. Mirror the VS Code side strip for the right panel control. Both columns use `size-shell-column`; keep their screen-edge anchors fixed across expanded and rail layouts. Do not place this control in a header or use it for the phone drawer (which remains the mobile menu button).

References: VS Code `layoutSidebarLeft` / `layoutSidebarLeftOff`, Orca `SidebarToggleIcon`, and GitHub sidebar footer disclosure.


Styles: style.css in this directory
