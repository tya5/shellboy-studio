# PanelTabs

- **Use for:** Switch among fixed Conversation inspector sections; retain counts, selected state and keyboard focus on the collapsed rail.
- **Do not use for:** Use NavItem for routes, Disclosure for headings and WorkSheet for the phone surface.
- **Why:** Tabs give local sections a selected state, while the icon rail stays usable without exposing hidden panel content.
- **Source:** [WAI-ARIA APG Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/); [VS Code Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface#_activity-bar)

Rail arrows move focus without opening; activation opens the section. Horizontal tabs scroll
and reveal the selected tab on selection/expansion, not count updates. Keep 2px gap, 10px
leading/16px trailing inset and 6px icon gap on the horizontal strip only. Share the amber
badge across both layouts; owner lower bounds use `+`. Collapsed panels stay hidden and
unfocusable without losing state.

Styles: style.css in this directory
