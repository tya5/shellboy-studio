# Chart

- **Use for:** Plot measured series as stacked columns or a line over time. Name the owner read and give exact values in a table.
- **Do not use for:** Use BarList for a short ranked comparison or DataTable when exact values matter more than the shape.
- **Why:** One scale aligns ticks and marks; legend and table retain series meaning and distinguish missing values from zero.
- **Source:** [Studio Analytics chart decisions](../../../../../../docs/design/analytics-settings.md#charts)

Use one axis, one baseline for stacked columns and a legend for multiple series. Use
`chart-1`/`chart-2`/`chart-3` for uncached input/cached input/output, never for text. Positive
columns remain visible at a 2px minimum. Measure rendered tick labels (including after fonts
load); hover, touch and arrows expose point values using the table formatter.

Styles: style.css in this directory
