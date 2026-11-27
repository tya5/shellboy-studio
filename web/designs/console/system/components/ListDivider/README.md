# ListDivider

- **Use for:** A group label over a run of rows in a flat list, such as the Activity categories in the conversation panel, with an optional count and trailing section action. The Activity categories keep one fixed order (running, pending, services, schedules) and are always shown, with an empty line when they have no rows.
- **Do not use for:** Use ThreadGroup for a band that collapses a long group, Section for a page-level subject card, and Disclosure for expandable content.
- **Why:** Design system v2 structure levels: a group label is clearly not a row. It has no icon, no surface, no hover and is not interactive, so the rows below it carry the marks and the hover.
- **Source:** [Apple HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [VS Code Views](https://code.visualstudio.com/api/ux-guidelines/views), [shadcn/ui Sidebar (SidebarGroupLabel)](https://ui.shadcn.com/docs/components/sidebar)

It renders the shared `.group-label` (`type-caption` at weight 500 in `muted`; uppercase with `letter-caps` in an English UI) as an `h3`, with the count in `type-code` at caption size. The label text starts at the rows' `space-8` inset. Inside the panel list it sits `space-16` below the previous group (the list's `space-12` gap plus `space-4`) and `space-4` above its first row. An optional action is aligned at the end of the heading row; its explanation uses body type below.

Styles: style.css in this directory

The heading row uses the shared `space-8` gap. Use `action` for one section-level control and `description` only for its short explanatory sentence. Do not pass row menus or multiple actions.
