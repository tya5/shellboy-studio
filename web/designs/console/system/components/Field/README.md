# Field

- **Use for:** Use a labelled single-line input with an icon, or a native select for compact phone navigation. Provide a distinct error message for invalid input.
- **Do not use for:** Use Composer for multiline messages and ChoiceList for a visible short radio group.
- **Why:** The wrapper owns the border and focus outline; the native control retains semantics and the placeholder is never its label.
- **Source:** 出典なし（この Studio で決めた）

A single-line text input with a leading icon. Provide a label through `ariaLabel`; the placeholder is a hint, not the label.

The wrapper owns the only border and background; the input remains transparent and borderless. Focus outlines the wrapper, disabled fields are dimmed, and `aria-invalid="true"` gives the wrapper the error treatment. Supply a descriptive error message separately.

Styles are colocated in `system/components/Field/style.css`.

Styles: style.css in this directory

Field also renders a tokenized native select when given `as="select"` and options; use it for compact phone-width navigation where a menu would obscure the view.
