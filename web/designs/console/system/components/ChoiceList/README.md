# ChoiceList

A short radio group for choosing one service or model. The visible group label is its
accessible label; the native radio `name` is generated independently for each
instance, so same-labeled groups in one form do not share selection. Use ButtonGroup
for two to four short options without notes.

The group follows native radio semantics: options with the same `name` form one
selection set, so never use the display label as that value.
