# Chip

- **Use for:** Filter Monitor by a state count; use the removable variant only in a filter list and label its removal.
- **Do not use for:** Use ChildrenChip for descendants and FilterChips for a set of active filters with Clear all.
- **Why:** The labelled count is actionable, and pressing the same filter again clears it.
- **Source:** [Studio Monitor cards and panes](../../../../../../docs/design/monitor-tiles.md)

A state count on Monitor that filters the cards. Provide the state and its count. Pressing it again clears the filter.

Styles are colocated in `system/components/Chip/style.css`.

Styles: style.css in this directory

Use the removable variant only inside a filter list; its accessible label describes the removal.
