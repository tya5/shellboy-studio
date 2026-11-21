# ThreadItem

A sidebar Thread row with a navigable `tree-link` main part and an optional
flow-positioned `tree-action` at the trailing edge. Use the action slot for the
shared row menu; do not overlay it on the title or use it for unrelated panes.
The row owns hover, current and focus layout while its main link remains the
accessible navigation target.

Rows expose their shared action control through `tree-action`; row context menus and ArrowDown use that same opener.
