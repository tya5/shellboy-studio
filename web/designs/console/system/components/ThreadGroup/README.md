# ThreadGroup

- **Use for:** Separate one Thread group with a sticky disclosure band; choose the checkbox variant only where the group is selectable.
- **Do not use for:** Use ThreadItem or SelectRow for a Thread, and ListDivider for a noninteractive Activity heading.
- **Why:** One band aligns its chevron with row actions and keeps group disclosure and selection separate.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md)

Groups Threads by owner-reported directory or state. The checkbox/bulk variant selects every listed row and shows mixed selection. When it also owns a group disclosure, it uses the exact same section-band and toggle as the sidebar variant, with exactly two adjacent controls: the checkbox label fills the full-height leading column and the disclosure fills the remaining band with no gap. Do not nest one control inside the other or center a short checkbox label in the band.

## Sidebar section band

Use the sidebar variant for repeated sections in a list: a full-width, sticky, opaque `raised` band with one-line truncated name, count, and a whole-band accessible disclosure button. The list container has no inline padding; the band fills it. The header has no inset and the whole disclosure button owns the shared leading/trailing tokens, except for the separate checkbox. Place the chevron in the shared `size-row-action` column (24px), aligned with the trailing row action/menu column. Do not add a separate text link. Mark only groups distinguished by meaning (for example Pinned); omit redundant directory/folder marks. Children remain in normal flow so the next sticky band displaces the previous one.

Reference: iOS plain-table section headers, Material subheaders, Orca `SectionHeader`, shadcn/ui Sidebar, WAI-ARIA disclosure button; approved Studio sidebar mock v8, section 1a B1.

The section band is one reusable ThreadGroup part with checkbox and no-checkbox variants, not screen-owned styling. Keep its dimensions and behavior here; consumers supply the group fact and toggle callback. Do not use it as a Thread row.

Styles are colocated in `system/components/ThreadGroup/style.css`.

Styles: style.css in this directory
