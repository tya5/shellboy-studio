A small chart drawn as inline SVG at the frame's real width, so text stays its true size on a phone. `columns` stacks series from one baseline; `line` plots change over time. One axis only. Ticks come from the same scale as the marks. A value above zero is at least 2px tall, so a small part of a stack stays visible; the table has the exact number.

- Series use `chart-1` to `chart-3`, with a fixed meaning: uncached input, cached input, output. A single series with no such identity uses `neutral`. Text never takes a series colour.
- Two or more series always get a legend. The table under the chart holds every value; hover, touch and arrow keys show one point's values.
- A value the owner didn't report is left out of the point: nothing is drawn and the table says so. Never pass 0 for unknown.
- `source` is required: name the owner read behind the numbers.

Y-axis labels are measured in the rendered SVG font, including after web fonts finish loading; the plot starts after the widest label. Until measurement is available a conservative text-width fallback avoids a clipped first render. `format` is shared with the table and tooltip; callers can use compact tick labels without changing the underlying data.
