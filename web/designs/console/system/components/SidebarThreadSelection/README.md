# SidebarThreadSelection

- **Use for:** Explicitly selecting sidebar Threads for exact-set delete and bulk archive/unarchive (#138). Place Select in the sidebar heading, SelectionBar after the filters, and each shared RowCheckbox before its Thread link. Preview deletion in ThreadDeleteDialog.
- **Do not use for:** Single-Thread actions, bulk tag editing, or pinned and unread counts. The sidebar keeps its own list, grouping and focus policy.
- **Behavior:** Archive requires a second explicit press. Changing selected rows or descendant scope clears that confirmation. Unarchive is immediate. Owner receipts supply result counts; selection updates only after accepted owner results.
- **Why:** Selection belongs to Thread IDs, so pinned and ordinary rows agree. No filter or collapsed tree expands the explicit selection. Cancel never deletes anything.
- **Lifetime:** `useSidebarThreadSelection` returns `start` and `bar` as render factories. Call them at their render sites; do not store the resulting mounted VNodes on the selection result or in retained callbacks. Preact parent links on those VNodes can keep obsolete Conversation renders alive.
- **Sources:** [SelectionBar](../SelectionBar/README.md) and [ThreadDeleteDialog](../ThreadDeleteDialog/README.md) (WAI-ARIA Alert Dialog).
