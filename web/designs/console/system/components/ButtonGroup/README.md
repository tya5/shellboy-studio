# ButtonGroup

- **Use for:** Choose one of a few short peer options as a segmented control: a view (Cards or Tiles), a state filter with counts, a period, a theme, a language, an effort level.
- **Do not use for:** Use Check in a fieldset when several options can be on at once, ChoiceList when options need explanatory notes, PanelTabs or AppTabs for real tabs that switch panels (`aria-controls`), and Button for independent actions such as Refresh, which sit outside the group.
- **Why:** Design system v2 segmented control: one container with only the chosen segment filled reads as one choice, where a row of bordered buttons read as separate actions.
- **Source:** [Material 3 Segmented buttons](https://m3.material.io/components/segmented-buttons/overview), [Radix Toggle Group](https://www.radix-ui.com/primitives/docs/components/toggle-group)

A row of Buttons choosing one option, each with `aria-pressed`. The container is one `raised` surface with `space-2` padding and `radius-s`; segments have no border of their own. The chosen segment uses `accent-bg` with an `accent` edge and `fg` text at weight 600; the others are `muted` and turn `fg` on hover. A count inside a segment goes in `<b>` and is set in `type-code`. Segment height is `size-control` minus `space-4` (`size-touch` minus `space-4` at phone width), so the whole control is `size-control` / `size-touch` high. It wraps when narrow.

Two or more groups in one row sit in a `.choice-row` (shared), which separates groups by `space-16`; an independent action in the same row is a `ghost` Button outside the group.

Styles: style.css in this directory
