Threads gathered by working directory or state. The heading names the group, in `mono` for a path, and its checkbox selects every row in it, showing mixed when only some are chosen. It holds SelectRow rows. Don't put a total here that the owner doesn't report. `fold` makes the group closable: its Show and Hide button carries the group name for assistive technology. Without `onSelect` there is no checkbox, for a group whose rows are not read yet.

Styles are colocated in `system/components/ThreadGroup/style.css`.

Styles: style.css in this directory

Sidebar headings use this same component, with an icon, count and fold control instead of a group checkbox. See patterns/thread-list.md (Orca and shadcn/ui Sidebar); do not use as a Thread row.
