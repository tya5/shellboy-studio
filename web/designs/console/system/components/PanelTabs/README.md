# PanelTabs

- **Use for:** Switch among fixed Conversation inspector sections; retain counts, selected state and keyboard focus on the collapsed rail.
- **Do not use for:** Use NavItem for routes, Disclosure for headings and WorkSheet for the phone surface.
- **Why:** Tabs give local sections a selected state, while the icon rail stays usable without exposing hidden panel content.
- **Source:** [WAI-ARIA APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/); [VS Code Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface#_activity-bar)

Use for the fixed conversation-panel sections, including Analytics and Settings. Follows the WAI-ARIA APG Tabs pattern and the VS Code icon-rail principle: the selected tab is explicit, and a collapsed rail shows icon, count and a focus/hover tooltip linked by `aria-describedby`. Rail arrow keys move focus without opening the panel; activation opens the selected tab. The conversation-panel WorkSheet uses the same tabs below 1180px.

Do not use for route navigation or collapsible section headings.

References: WAI-ARIA APG Tabs; VS Code Activity Bar icon rail.

Styles: style.css in this directory

**Adaptive horizontal Tabs variant.** Use for a fixed inspector strip where all destinations must remain reachable without horizontal scrolling. Show all labels when their measured max-content row fits the strip. Otherwise show the selected tab's icon and full label, with inactive icons and their count badges. If the compact row needs more room, wrap complete buttons rather than clipping or truncating labels. Full accessible names and owner counts are present in both modes; focus and selection stay on the same buttons as the layout changes. The inert measurement row has no focus targets and is hidden from assistive technology. Do not use this variant for route navigation, the phone picker, or the collapsed vertical rail.

The horizontal tabs and rail share the amber `panel-tab-count` part. Keep the accent underline, hover surface, and established badge tokens. See [Material 3 navigation bar](https://m3.material.io/components/navigation-bar/guidelines) for the active-label visual pattern; keyboard and semantics remain Tabs, not navigation links.

When the owning right panel is collapsed, the icon rail and counts remain interactive while all tabpanel content is hidden and unfocusable; the footer stays anchored in the flex middle. Do not keep active content visible in the collapsed rail.

Use an owner-provided count for each reply direction. A `+` suffix marks a lower bound in the existing badge.

Phone variant: at the app's narrow container width, use the visibly labeled native section picker; do not use it for route navigation or on wide layouts. The horizontal tabs and collapsed icon rail remain the desktop variants.
