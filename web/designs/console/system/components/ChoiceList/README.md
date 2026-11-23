# ChoiceList

- **Use for:** Choose one service or model from a short radio group with room for notes.
- **Do not use for:** Use ButtonGroup for two to four short options without notes; use Check for a standalone yes/no choice.
- **Why:** The visible group label and a unique native radio name preserve one selection per group, even when two groups have the same label.
- **Source:** 出典なし（この Studio で決めた）

A short radio group for choosing one service or model. The visible group label is its
accessible label; the native radio `name` is generated independently for each
instance, so same-labeled groups in one form do not share selection. Use ButtonGroup
for two to four short options without notes.

The group follows native radio semantics: options with the same `name` form one
selection set, so never use the display label as that value.

Styles are colocated in `system/components/ChoiceList/style.css`.

Styles: style.css in this directory
