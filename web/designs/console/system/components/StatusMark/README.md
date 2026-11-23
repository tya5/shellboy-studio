# StatusMark

- **Use for:** Show mapped owner state with a shape and color, normally paired with a word; use `statusOf` rather than choosing a shape by color.
- **Do not use for:** Use the sidebar's title emphasis for unread; don't invent states or use color alone.
- **Why:** Equal diameters and distinct interiors distinguish real owner states without conflating them.
- **Source:** [Studio status-mark decisions](../../../../../../docs/design/design-system.md#the-console-design); Orca/Lucide mappings are recorded in the [Icon catalog](../Icon/README.md).

Base states: `run`, `wait`, `bad`, `ok`. Additional owner states: `hold` for non-person
waiting (ring with center dot), `fail` (cross), `halt` (square), and `idle` (empty circle).
Omit the word only where dense rows already name the subject.

Styles: style.css in this directory
