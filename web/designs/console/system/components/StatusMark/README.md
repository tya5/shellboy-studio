Shows a Thread's or step's state with a shape, a colour and usually a word.

Provide the state: `run`, `wait`, `bad` or `ok`. Use the word except in dense trees, where the row itself names the item. Do not add states or use colour alone.

Added for shellboy-studio: the owner reports states the reference doesn't name, and they can't be merged without changing their meaning. They are `hold` (waiting on something other than a person: a ring with a centre point in `muted`), `fail` (ended by failure: a cross in `bad`), `halt` (stopped by request: a square in `muted`) and `idle` (ready for input: a dashed ring in `muted`). Each differs from the others in shape. Map states through `statusOf` in ui-core; don't choose a mark by colour.
