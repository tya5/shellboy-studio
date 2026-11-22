# PanelTabs

Use for the four fixed conversation-panel sections. Follows the WAI-ARIA APG Tabs pattern and the VS Code icon-rail principle: the selected tab is explicit, and a collapsed rail shows icon, count and a focus/hover tooltip linked by `aria-describedby`. Rail arrow keys move focus without opening the panel; activation opens the selected tab. The phone WorkSheet does not use this component.

Do not use for route navigation or collapsible section headings.

References: WAI-ARIA APG Tabs; VS Code Activity Bar icon rail.

Styles: style.css in this directory

The same linked tooltip is also used when the expanded panel uses icon-only tabs at 1180–1279px.

Horizontal tab rows never overlap or clip their labels; they scroll horizontally when needed, and the selected tab is moved into view with the minimal scroll. The vertical icon rail is unchanged.

The tab buttons use design-system spacing tokens for row gap, leading/trailing insets, and icon-to-label gap. Labels reserve the same badge corner whether a count is present or absent; the small amber count is overlaid at the label's top-right and never participates in tab sizing. The selected tab is bold with the accent underline; hover adds a raised tint. Keep these placements identical when adding a count or changing locale.
