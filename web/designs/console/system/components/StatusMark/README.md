# StatusMark

- **Use for:** Show mapped owner state with a shape and color, normally paired with a word; use `statusOf` rather than choosing a shape by color.
- **Do not use for:** Use the sidebar's title emphasis for unread; don't invent states or use color alone.
- **Why:** Equal diameters and distinct interiors distinguish real owner states without conflating them.
- **Source:** [Studio status-mark decisions](../../../../../../docs/design/design-system.md#the-console-design); Orca/Lucide mappings are recorded in the [Icon catalog](../Icon/README.md).

Shows a Thread's or step's state with a shape, a colour and usually a word.

Provide the state: `run`, `wait`, `bad` or `ok`. Use the word except in dense trees, where the row itself names the item. Do not add states or use colour alone.

Added for shellboy-studio: the owner reports states the reference doesn't name, and they can't be merged without changing their meaning. They are `hold` (waiting on something other than a person: a ring with a centre point in `muted`), `fail` (ended by failure: a cross in `bad`), `halt` (stopped by request: a square in `muted`) and `idle` (ready for input: an empty circle in `muted`). Every mark uses the same outer diameter and differs by its interior shape (empty, dot, question, check, alert) as well as color; no state is communicated by color alone. Map states through `statusOf` in ui-core; don't choose a mark by colour.

Styles: style.css in this directory

References: Orca sidebar status vocabulary and Lucide circle/check/help/alert semantics. Keep the outer diameter equal across states; distinguish with interior shape and color. Do not use status marks as unread indicators.
