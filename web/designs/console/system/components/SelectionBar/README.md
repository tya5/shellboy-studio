# SelectionBar

- **Use for:** Show a Thread selection total and available owner actions while a selection exists.
- **Do not use for:** Use the row Menu for single-target actions; don't offer bulk deletion without an atomic owner contract.
- **Why:** Counts, affected descendants and explicit confirmation keep the scope of consequential actions visible.
- **Source:** [Studio Threads design](../../../../../../docs/design/branches-threads.md#threads-what-is-real)

Stays at the top of the list while something is chosen, and states how many, including descendants the action would also touch. Actions are real owner operations only. An action that can't be undone in one step needs a second press.

Styles are colocated in `system/components/SelectionBar/style.css`.

Styles: style.css in this directory
