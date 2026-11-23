# ListRow

- **Use for:** Give list items a shared shell with a reserved in-flow action column; compose Thread links and checkboxes as siblings, or use a button for panel selection.
- **Do not use for:** Use Message for conversation bodies and ThreadGroup for section bands.
- **Why:** The row owns its menu through `useRowMenu`; reserved space prevents title shifts, and touch always exposes the action.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

`onSelect` receives the actual row button for focus return. Keep per-target errors after the
row and trailing metadata in `afterActions`. The shared 24px action column aligns with band
chevrons; the 44px phone hit area does not widen it. The Possessions attachment list retains
at most 1,000 rows and reports incomplete detail.

Styles: style.css in this directory
