# StepRow

- **Use for:** Disclose one tool call or child Thread; use a grouped row for related tool calls.
- **Do not use for:** Use Disclosure for generic content and WorkElementRow for issued Work members.
- **Why:** A compact heading preserves state and timing while output stays behind the disclosure in LogBlock.
- **Source:** 出典なし（この Studio で決めた）

One tool call or child Thread inside a conversation, collapsed by default.

Provide the name or command, state, duration, exit code and output. Commands use `code`; output uses a log block on `inset`. Open the row to show output; an open row takes an `accent` border.

A grouped row contains a flat, divided list of tool rows. Only the outer group has a border and radius; nested rows use a background for hover and keyboard focus, and inset their output. Standalone rows retain their own border and open-state accent.

Styles: style.css in this directory
