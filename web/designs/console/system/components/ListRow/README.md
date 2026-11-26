# ListRow

- **Use for:** Give list items a shared shell with a reserved in-flow action column; compose Thread links and checkboxes as siblings, or use a button for panel selection.
- **Do not use for:** Use Message for conversation bodies and ThreadGroup for section bands.
- **Why:** The row owns its menu through `useRowMenu`; the panel action slot reserves the full hit area so the existing one-line title can truncate without horizontal scroll. Reserved space prevents title shifts, and touch always exposes the action.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Shared list shell for one item with a reserved, in-flow action slot. It owns the row
menu state, placement and keyboard handling through `useRowMenu`. Actions reveal
on hover, row focus, selection or while open; touch always shows the action.

Panel items provide a title, an optional `command` caption, and `onSelect`, which receives the actual row button
for focus return. `subtitle` is noninteractive row metadata inside the selection button: text, or a
component that updates on its own (an elapsed-time caption reads the clock itself, so a tick re-renders
only that caption, not the row or its list). Never put controls or links in it. Use `error` for a per-target error, or `feedback` for custom
status and alert content. ListRow places feedback on its own line after the row,
not in the trailing action slot. Keep a live region mounted in `feedback` when
its announcement text changes. Thread rows
supply their native link or checkbox layout; the action stays a sibling of those
controls. For Thread rows, `afterActions` keeps trailing metadata in its existing
position. Panel rows can use this slot for an always-visible, independently
labelled action after the selection button, such as revealing an artifact.
Do not use for conversation message bodies.

A panel row's `afterActions` slot owns focus for its action: when an owner update removes the action while it is the active element (for example Move to background on the foreground shell), focus moves to the row's own selection button at that moment; when focus is anywhere else, including the page body, nothing moves. Callers render a plain Button there.

References: WAI-ARIA APG Menu Button; shadcn/ui SidebarMenuAction; system `useRowMenu`.

Styles: style.css in this directory

The Possessions section uses these rows for attachment metadata. Its loaded list
retains at most 1,000 rows (shared with the Thread list) to bound memory and
change-hint refresh work. An incomplete cut reports unloaded detail as such.

Align row action icons with the 24px section-band chevron column. Sidebar rows reserve the full 44px touch target in normal flow and reduce the end inset by half the difference to keep the icon centered on the same axis. See patterns/thread-list.md; this is not a list-level control.
