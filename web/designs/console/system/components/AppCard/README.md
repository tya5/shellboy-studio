# AppCard

- **Use for:** Show one app library entry, its folder and bound Thread; replace the open link with the reason if unavailable.
- **Do not use for:** For an open app's page use AppFrame; for a Thread summary use the sidebar ThreadItem.
- **Why:** The card makes the app's identity and whether it can open visible before opening it.
- **Source:** [Studio Apps design](../../../../../../docs/design/apps.md)

One app in the app list: title, folder name, and its bound Thread. If the app can't open, the card uses the `err` tone and gives the reason in place of the open link. Design system v2: "Open" and named instances are navigation, so they are standalone text links (`.nav-link`), not buttons.

Styles: style.css in this directory
