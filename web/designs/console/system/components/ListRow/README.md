# ListRow

Shared list shell for one item with a reserved, in-flow action slot. It owns the row
menu state, placement and keyboard handling through `useRowMenu`. Actions reveal
on hover, row focus, selection or while open; touch always shows the action.

Panel items provide a title and `onSelect`, which receives the actual row button
for focus return. A per-target error can be displayed after the row. Thread rows
supply their native link or checkbox layout; the action stays a sibling of those
controls. `afterActions` keeps trailing metadata in its existing position.
Do not use for conversation message bodies.

References: WAI-ARIA APG Menu Button; shadcn/ui SidebarMenuAction; system `useRowMenu`.

Styles: style.css in this directory

The Possessions section uses these rows for attachment metadata. Its loaded list
retains at most 1,000 rows (shared with the Thread list) to bound memory and
change-hint refresh work. An incomplete cut reports unloaded detail as such.

All rows reserve the same 24px trailing action column as their section-band chevron. On phone widths the 44px menu hit area is centered over that column without widening it. Sidebar rows keep the full touch target in-flow. See patterns/thread-list.md; this is not a list-level control.
