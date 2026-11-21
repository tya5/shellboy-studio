Runs one action. The label says what happens.

Provide a label and optionally an icon. Use `primary` once per region for the main action, `warn` for answering or retrying, `stop` only for stopping a Run. `quiet` is a borderless auxiliary icon control inside a row or card; it keeps the standard hit area and shows a surface only on hover or keyboard focus. Do not use `quiet` for primary actions. Use a 44px minimum hit size on phone width. This row-action use follows shadcn/ui `SidebarMenuAction`.


`buttonRef` exposes the underlying button element when a caller needs to place initial
focus (for example, the Cancel action of an alert dialog) without replacing Button's
styles and semantics with a raw button.
