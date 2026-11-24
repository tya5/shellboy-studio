# LogBlock

- **Use for:** Show machine output in an inset, independently scrolling block; use `boxed` outside StepRow.
- **Do not use for:** Use Message for conversational prose and DataTable for structured comparison.
- **Why:** The log type preserves machine formatting without letting long lines widen the page.
- **Source:** 出典なし（この Studio で決めた）

Machine output on `inset` in the `log` type. It scrolls inside itself, so a long line never widens the page. Use `boxed` outside a StepRow.

Styles: style.css in this directory

Phone variant: tool output wraps by default for readable long paths; the explicit Wrap lines switch changes presentation only and Copy always uses the original unmodified output. Do not use wrapping where fixed columns are the task's meaning; turn wrapping off there.
