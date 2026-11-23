# Button

- **Use for:** Run a single named action; use `primary` once per region, `warn` for answering or retrying, and `stop` only for stopping a Run.
- **Do not use for:** Use NavItem or a link for navigation and ButtonGroup for choosing one option. Don't use `quiet` for the primary action.
- **Why:** The variant signals prominence without changing button semantics; quiet row actions retain a hit area, including 44px minimum on phones.
- **Source:** [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Use `buttonRef` for initial focus (for example Cancel in an alert dialog). Caller classes are
additive.

Styles: style.css in this directory
