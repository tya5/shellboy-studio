# Button

- **Use for:** Run a single named action; use `primary` once per region, `warn` for answering or retrying, and `stop` only for stopping a Run.
- **Do not use for:** Use NavItem or a link for navigation and ButtonGroup for choosing one option. Don't use `quiet` for the primary action.
- **Why:** The variant signals prominence without changing button semantics; quiet row actions retain a hit area, including 44px minimum on phones.
- **Source:** [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Runs one action. The label says what happens. Optional caller classes are additive to the base `.btn` and variant classes.

Provide a label and optionally an icon. Use `primary` once per region for the main action, `warn` for answering or retrying, `stop` only for stopping a Run. `quiet` is a borderless auxiliary icon control inside a row or card; it keeps the standard hit area and shows a surface only on hover or keyboard focus. Do not use `quiet` for primary actions. Use a 44px minimum hit size on phone width. This row-action use follows shadcn/ui `SidebarMenuAction`.


`buttonRef` exposes the underlying button element when a caller needs to place initial
focus (for example, the Cancel action of an alert dialog) without replacing Button's
styles and semantics with a raw button.

Styles: style.css in this directory
