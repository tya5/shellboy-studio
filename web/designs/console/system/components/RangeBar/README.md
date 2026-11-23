# RangeBar

- **Use for:** Show a measured before/after change in a table cell, with both values and a shared maximum.
- **Do not use for:** Use Meter for one value against a limit and Chart for a time series. Omit the bar when either fact is unknown.
- **Why:** The bar enables proportion comparisons while exact values remain visible beside it.
- **Source:** 出典なし（この Studio で決めた）

Shows a change between two measured values in a table cell, for instance input tokens before and after a compaction. The solid end marks `to`. Every row in one table uses the same `max`. Write both numbers beside it: the bar shows proportion and the numbers are the fact. Leave the bar out when either value is unknown.

Styles are colocated in `system/components/RangeBar/style.css`.

Styles: style.css in this directory
