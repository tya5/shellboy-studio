# Disclosure

- **Use for:** Expose caller-supplied content using native `details` and `summary` inside Console screens.
- **Do not use for:** Use StepRow for a tool heading, WorkElementRow for issued Work, and Popover for anchored controls.
- **Why:** This primitive keeps native disclosure markup inside the system without adding styling or owning open state.
- **Source:** 出典なし（この Studio で決めた）

Use for native disclosure containers within Console screens when StepRow's tool
heading is not appropriate. Pass existing details attributes, summary and children;
this primitive adds no styling, state, identity, or authority. Callers own controlled
open choices. Keep raw details markup inside this system boundary.

Styles: style.css in this directory
