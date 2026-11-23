# Field

- **Use for:** Use a labelled single-line input with an icon, or a native select for compact phone navigation. Provide a distinct error message for invalid input.
- **Do not use for:** Use Composer for multiline messages and ChoiceList for a visible short radio group.
- **Why:** The wrapper owns the border and focus outline; the native control retains semantics and the placeholder is never its label.
- **Source:** 出典なし（この Studio で決めた）

The input itself has no border. The wrapper also carries invalid and disabled treatments.

Styles: style.css in this directory
