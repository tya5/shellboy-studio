# ThreadGroup

Groups Threads by owner-reported directory or state. The checkbox/bulk variant selects every listed row and shows mixed selection. When it also owns a group disclosure, it uses the exact same section-band and toggle as the sidebar variant, with only the checkbox added as the leading control; do not nest one control inside the other.

## Sidebar section band

Use the sidebar variant for repeated sections in a list: a full-width, sticky, opaque `raised` band with one-line truncated name, count, and a whole-band accessible disclosure button. Place the trailing chevron in the shared `size-row-action` column (24px), aligned with the trailing row action/menu column. Do not add a separate text link. Mark only groups distinguished by meaning (for example Pinned); omit redundant directory/folder marks. Children remain in normal flow so the next sticky band displaces the previous one.

Reference: iOS plain-table section headers, Material subheaders, Orca `SectionHeader`, shadcn/ui Sidebar, WAI-ARIA disclosure button; approved Studio sidebar mock v8, section 1a B1.

The section band is one reusable ThreadGroup part with checkbox and no-checkbox variants, not screen-owned styling. Keep its dimensions and behavior here; consumers supply the group fact and toggle callback. Do not use it as a Thread row.

Styles are colocated in `system/components/ThreadGroup/style.css`.

Styles: style.css in this directory
