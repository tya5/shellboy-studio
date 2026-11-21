# ThreadItem

A sidebar Thread row with a navigable `tree-link` main part and an optional
flow-positioned `tree-action` at the trailing edge. Use the action slot for the
shared row menu; do not overlay it on the title or use it for unrelated panes.
The row owns hover, current and focus layout while its main link remains the
accessible navigation target.

Rows expose their shared action control through `tree-action`; row context menus and ArrowDown use that same opener.

The trailing menu remains in-flow and is revealed on row hover, focus, or selection; the title keeps its ellipsis rather than moving beneath the action.

The approved row-menu mark is the vertical three-dot `more` icon.

`useRowMenu` owns the row menu state and opener; `.menu-open` keeps the in-flow trigger visible until focus returns.
