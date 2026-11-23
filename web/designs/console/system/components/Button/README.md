# Button

- **Use for:** Run a single named action. `ghost` for most actions, including every icon-only button in headers, toolbars, rows and cards; `primary` once per region for its main action; `outline` (the default) only for a secondary action beside that primary; `warn` for answering or retrying; `stop` only for stopping a Run.
- **Do not use for:** Use a text link (`a`, or `.nav-link` when standalone) for navigation, ButtonGroup for choosing one of a few options, and Chip or a tag badge for tags. Never use `ghost` for the primary action.
- **Why:** Design system v2 action strength: a bordered or filled box is reserved for the one primary action and its adjacent secondary action, so the main action stands out and the rest of a region stays quiet.
- **Source:** [Material 3 Buttons](https://m3.material.io/components/all-buttons), [shadcn/ui Button](https://ui.shadcn.com/docs/components/button), [Apple HIG Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Material 3 Icon buttons](https://m3.material.io/components/icon-buttons/overview), [Studio row actions](../../patterns/row-actions.md)

Runs one action. The label says what happens, also while the action is busy: keep the action label, disable the button and put a `role="status"` line beside it. Optional caller classes are additive to the base `.btn` and variant classes.

| Variant | Look | Use |
|---|---|---|
| `primary` | `accent` fill, `on-accent` text | The one main action of a region (Send, Save). |
| `ghost` | No border or fill; `hover` surface on hover, keyboard focus and while its menu or popover is open (`aria-haspopup` + `aria-expanded`). Icon-only ghost buttons draw their icon in `muted` | Most actions, and every icon-only button. |
| `outline` (default) | `line-strong` border, `raised` on hover | Only a secondary action beside a primary one (Cancel next to Delete). Not on its own. |
| `link` | `accent` text, underline on hover and focus | A link-styled action inside text. An action that does not navigate is otherwise `ghost`. |
| `warn`, `stop` | `wait` / `bad` border and text | Answering or retrying; stopping a Run. |

Icon-only buttons pass `icon` and `label`; `label` becomes the accessible name. Add a tooltip with the same words. The box is `size-control` on desktop and `size-touch` at phone width. Row actions keep `size-row-action` and their hit extension (see `patterns/row-actions.md`).

`buttonRef` exposes the underlying button element when a caller needs to place initial
focus (for example, the Cancel action of an alert dialog) without replacing Button's
styles and semantics with a raw button.

Styles: style.css in this directory
