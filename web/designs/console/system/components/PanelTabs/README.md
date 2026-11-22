# PanelTabs

Use for the four fixed conversation-panel sections. Follows the WAI-ARIA APG Tabs pattern and the VS Code icon-rail principle: the selected tab is explicit, and a collapsed rail shows icon, count and a focus/hover tooltip linked by `aria-describedby`. Rail arrow keys move focus without opening the panel; activation opens the selected tab. The phone WorkSheet does not use this component.

Do not use for route navigation or collapsible section headings.

References: WAI-ARIA APG Tabs; VS Code Activity Bar icon rail.

Styles: style.css in this directory

Horizontal tab rows never overlap or clip their labels; they scroll horizontally when needed, and PanelTabs minimally reveals the selected tab on selection change or expansion. Count and other item updates preserve manual scroll. The vertical icon rail is unchanged.

Horizontal tab buttons use `--space-2` for the row gap and `--space-10` for the leading inset, preserving the approved 2px and 10px values. Trailing inset and icon-to-label gap use `--space-16` and `--space-6`. Keep all horizontal-only spacing and scrolling scoped off the unchanged vertical rail. Labels reserve the same badge corner whether a count is present or absent; the small amber count is overlaid at the label's top-right and never participates in tab sizing. The selected tab is bold with the accent underline; hover adds a raised tint. Keep these placements identical when adding a count or changing locale.


The expanded tabs and collapsed icon rail use the same amber `panel-tab-count` badge part and tokens; only its anchor differs between the label corner and the rail button corner. Do not add a second rail pill or restyle its color/shape.

When the owning right panel is collapsed, the icon rail and counts remain interactive while all tabpanel content is hidden and unfocusable; the footer stays anchored in the flex middle. Do not keep active content visible in the collapsed rail.

Use an owner-provided count for each reply direction. A `+` suffix marks a lower bound in the existing badge.
