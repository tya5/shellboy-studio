# ThreadItem

- **Use for:** Render a sidebar Thread as a link with its status, depth, descendant summary and in-flow actions.
- **Do not use for:** Use SelectRow when multi-selection is the main task and ThreadGroup for group headings.
- **Why:** A reserved trailing action slot keeps the title stable; bold title, not an extra status mark, denotes unread completion.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md); [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Left/Right on a parent link controls disclosure; ArrowDown opens its separate menu. Read state
changes only once the destination and its detail are available; menu read actions require an
answer ID. Never signal child unread on the parent chip. Retain stable link IDs and true
full-width row highlights.

Styles: style.css in this directory
