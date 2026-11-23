# ThreadGroup

- **Use for:** Separate one Thread group with a sticky disclosure band; choose the checkbox variant only where the group is selectable.
- **Do not use for:** Use ThreadItem or SelectRow for a Thread, and ListDivider for a noninteractive Activity heading.
- **Why:** One band aligns its chevron with row actions and keeps group disclosure and selection separate.
- **Source:** [Studio Thread list (Orca, shadcn/ui, APG)](../../patterns/thread-list.md)

Use the shared 24px row-action column; no separate text link or redundant folder marks. Keep
children in normal flow so the next band displaces the one above.

Styles: style.css in this directory
