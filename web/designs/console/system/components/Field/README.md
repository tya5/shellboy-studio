# Field

- **Use for:** A single-line input, optionally with a leading icon (a search field always has one), or a native select for compact phone navigation. Give it a visible `label` above it, with `help` or `error` text below, wherever the name is not already shown beside it (SettingRow shows its own).
- **Do not use for:** Use Composer for multiline messages, ChoiceList for a visible short radio group, Check in a fieldset for several options that can be on at once, and SettingRow for a setting with its name and explanation beside the control.
- **Why:** The wrapper owns the border and focus outline; the native control keeps its semantics. A visible name and described help or error mean the placeholder is never the label. Design system v2 settles field names on `type-label`.
- **Source:** [shadcn/ui Field](https://ui.shadcn.com/docs/components/field), [Material 3 Text fields](https://m3.material.io/components/text-fields/overview)

The wrapper owns the only border and background (`inset`, `line-strong`); the input remains transparent and borderless and fills the wrapper. Focus outlines the wrapper, disabled fields are dimmed. The control is `size-control` high (`size-touch` at phone width).

- Without `label`, name the control with `ariaLabel`; the placeholder is only a hint or an example.
- With `label`, `help` or `error`, the field stacks: the name in `type-label` `fg`, the control, then `help` in `type-caption` `muted` or `error` in `type-caption` `bad`, each `space-4` apart. The name is tied by `for`; help and error by `aria-describedby`. `error` also sets `aria-invalid="true"`, which gives the wrapper the `bad` border and `err-bg` ground.
- Stacked fields in a column sit `space-12` apart.
- Numbers, paths and other machine values in the input use `class="mono"` (`type-code`).

Field also renders a tokenized native select when given `as="select"` and options; use it for compact phone-width navigation where a menu would obscure the view.

Styles: style.css in this directory
