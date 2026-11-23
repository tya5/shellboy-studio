# AppTabs

- **Use for:** Switch between the app library and open apps. Show unread errors with a recovery diamond; keep the strip scrollable on phones.
- **Do not use for:** Use PanelTabs for fixed inspector sections and NavItem for routes.
- **Why:** Switching preserves the mounted page; closing ends it. Explicit Reload remounts that app page without touching app data.
- **Source:** [Studio Apps design](../../../../../../docs/design/apps.md)

Tabs over the app pane: the app list first, then each open app. An app with unread errors shows the recovery diamond beside its name. Each app tab has a manual reload action that remounts its page without touching app data. Closing a tab ends that app's page; moving to another tab or view doesn't. The strip scrolls in its own frame on a phone.

Design system v2 sizes: the strip is `size-header` high, the current tab has a `space-2` accent edge, close is a `size-row-action` ghost icon button and add a `size-control` one (both `size-touch` at phone width), with the `hover` surface; the named-instance Open is ghost.

Styles are colocated in `system/components/AppTabs/style.css`.

Styles: style.css in this directory
