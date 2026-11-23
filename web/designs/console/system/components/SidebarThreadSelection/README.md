# SidebarThreadSelection

- **Use for:** Explicitly selecting sidebar Threads for exact-set deletion (#36).
  Place Select in the sidebar heading, SelectionBar after the filters, and each
  shared RowCheckbox before its Thread link. Preview in ThreadDeleteDialog.
- **Do not use for:** Single-Thread actions, archive/tag selection, or pinned and
  unread counts. The sidebar keeps its own list, grouping and focus policy.
- **Why:** Selection belongs to Thread IDs, so pinned and ordinary rows agree.
  No filter or collapsed tree expands the set. Cancel never deletes anything.
- **Sources:** [SelectionBar](../SelectionBar/README.md) and
  [ThreadDeleteDialog](../ThreadDeleteDialog/README.md) (WAI-ARIA Alert Dialog).

Uses existing components and tokens; no additional styles.
