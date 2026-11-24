# ThreadGroup

- **Use for:** A band over a long group of Threads that can collapse: the sidebar Pinned, All and Archive bands, and the Threads page groups; use the checkbox variant only where the group is selectable.
- **Do not use for:** Use ThreadItem or SelectRow for a Thread, ListDivider (`.group-label`) for a static group label that does not collapse, and Section for a subject card.
- **Why:** Design system v2 structure levels: a band is a group label with a surface. The inset surface between two lines shows where a group starts without looking like a row, and the whole band is one disclosure button.
- **Source:** [Apple HIG Lists and tables (section headers)](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), [Material 3 Lists](https://m3.material.io/components/lists/overview), [Material 3 Divider](https://m3.material.io/components/divider/overview), [shadcn/ui Sidebar (SidebarGroupLabel)](https://ui.shadcn.com/docs/components/sidebar), [WAI-ARIA APG Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/), [Studio Thread list](../../patterns/thread-list.md)

## Band

A full-width, sticky, opaque band: `inset` surface, a `line` above and below, height `size-control` (`size-touch` at phone width). Its text is the group-label role: `type-caption` at weight 500 in `muted`, uppercase with `letter-caps` in an English UI. The count is `type-code` at caption size. The name is one line and truncates.

- No leading mark: bands carry no icon (the earlier Pinned pin mark and All list mark are gone). Rows carry the marks.
- No hover surface: the whole band is the accessible disclosure button (`aria-expanded`), and only its small trailing chevron (`size-icon-small`, `muted`, `fg` on hover) shows that it opens. Do not add a separate text link.
- The chevron sits in the list's `size-row-action` column, aligned with the trailing row action. The band's left inset is `space-8`, the same as the row marks; its right inset is `space-row-inset`.
- Spacing: `space-8` above a band that follows another group, `space-4` between the band and its first row. The first band has no top line.
- Pass `verbatim` when the name is owner data (a tag), and `mono` when it is machine text (a directory). Neither is uppercased.

The component accepts text-only labels (no icon slot), as bands carry no icon. The list container has no inline padding; the band fills it. Children remain in normal flow so the next sticky band displaces the previous one. The count uses the same localized "Threads: {n}" wording on every surface, with `+` after `n` when the owner reports more than were read; while its owner read is in flight, use the existing LoadingCount in this slot, never a provisional zero, and mark the band `aria-busy` until the read settles.

## Checkbox variant

The checkbox/bulk variant selects every listed row and shows mixed selection. With a disclosure it uses the same band, with exactly two adjacent controls: the checkbox label fills the full-height leading column (`size-control` wide, `size-touch` at phone width, matching SelectRow's checkbox) and the disclosure fills the rest of the band with no gap. Do not nest one control inside the other or center a short checkbox label in the band.

The band is one reusable ThreadGroup part, not screen-owned styling. Consumers supply the group fact and toggle callback. Do not use it as a Thread row.

Styles: style.css in this directory
