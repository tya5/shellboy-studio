# DataTable

- **Use for:** Compare exact facts down columns; align numbers right in mono and stack label/value pairs on phones unless a `flat` table fits.
- **Do not use for:** Use FactList for one subject's facts or Chart to emphasize a trend.
- **Why:** Stacking keeps labels and values available without sideways page scrolling; owner text is passed as children, not markup.
- **Source:** 出典なし（この Studio で決めた）

Rows of facts that compare down a column. Numeric columns align right in the mono face. At phone width each row stacks into label and value pairs, so no column is hidden and the page never scrolls sideways; `flat` keeps columns for a narrow table known to fit, such as a chart's values. Text that came from the owner goes in as children, so it is never parsed as markup.

`centerRows` opts into vertical centering for rows with taller content, such as a compact chart and its numeric values. Standard fact tables remain top-aligned.

Styles are colocated in `system/components/DataTable/style.css`.

Styles: style.css in this directory
