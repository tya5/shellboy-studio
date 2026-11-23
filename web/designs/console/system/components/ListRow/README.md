# ListRow

- **Use for:** Give list items a shared shell with a reserved in-flow action column; compose Thread links and checkboxes as siblings, or use a button for panel selection.
- **Do not use for:** Use Message for conversation bodies and ThreadGroup for section bands.
- **Why:** The row owns its menu through `useRowMenu`; reserved space prevents title shifts, and touch always exposes the action.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

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

Sidebar rows reserve the full touch target for the in-flow action. See patterns/thread-list.md; this is not a list-level control.

Use `touchRow` for a panel row that must retain the shared touch height on a narrow screen even with a mouse attached.
