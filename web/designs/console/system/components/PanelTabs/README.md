# PanelTabs

- **Use for:** Switch among fixed Conversation inspector sections; retain counts, selected state and keyboard focus on the collapsed rail.
- **Do not use for:** Use NavItem for routes, Disclosure for headings and WorkSheet for the phone surface.
- **Why:** Tabs give local sections a selected state, while the icon rail stays usable without exposing hidden panel content.
- **Source:** [WAI-ARIA APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/); [VS Code Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface#_activity-bar)

Use for the fixed conversation-panel sections, including Analytics and Settings. Follows the WAI-ARIA APG Tabs pattern and the VS Code icon-rail principle: the selected tab is explicit, and a collapsed rail shows icon, count and a focus/hover tooltip linked by `aria-describedby`. Rail arrow keys move focus without opening the panel; activation opens the selected tab. The conversation-panel WorkSheet uses the same tabs below 1180px.

Do not use for route navigation or collapsible section headings.

References: WAI-ARIA APG Tabs; VS Code Activity Bar icon rail.

Styles: style.css in this directory

**Adaptive horizontal Tabs variant.** Use for fixed Conversation inspector sections. In the dock and in the explicitly placed bottom sheet, show all labels when their measured row fits. Otherwise show only the active label alongside every icon and count. If that row also does not fit, show icons and counts only and name the selected tab in the heading (`Panel · Tab`). The strip stays on one line without horizontal scrolling or truncation. Full accessible names stay on the same buttons at all widths. The inert measurement rows have no focus targets and are hidden from assistive technology. Do not use this for route navigation, unrelated WorkSheets, or the collapsed vertical rail.

The horizontal tabs and rail share the amber `panel-tab-count` part. Keep the accent underline, hover surface, and established badge tokens. See [Material 3 navigation bar](https://m3.material.io/components/navigation-bar/guidelines) for the active-label visual pattern; keyboard and semantics remain Tabs, not navigation links.

When the owning right panel is collapsed, the icon rail and counts remain interactive while all tabpanel content is hidden and unfocusable; the footer stays anchored in the flex middle. Do not keep active content visible in the collapsed rail.

Use an owner-provided count for each reply direction. A `+` suffix marks a lower bound in the existing badge.

Phone variant: at the app's narrow container width, use the visibly labeled native section picker; do not use it for route navigation or on wide layouts. The horizontal tabs and collapsed icon rail remain the desktop variants.
