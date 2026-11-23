# Notice

- **Use for:** State a view-level problem or in-progress condition and give a next action when available.
- **Do not use for:** Use SettingRow or ListRow for row-local errors and EmptyState for a successful empty view.
- **Why:** A notice gives screen-wide conditions one clear location without misattributing them to a row.
- **Source:** 出典なし（この Studio で決めた）

A message that belongs to the screen, not to one row: connection trouble, a failed action, a Thread in recovery wait. `bad` for failures, `wait` for things in progress, plain otherwise. Say what happened and what to do; put the action in it.

Styles are colocated in `system/components/Notice/style.css`.

Styles: style.css in this directory
