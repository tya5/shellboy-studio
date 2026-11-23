# Notice

- **Use for:** State a view-level problem or in-progress condition and give a next action when available; the `banner` variant for an application-wide condition, such as running without authentication, in one row above the header.
- **Do not use for:** Use SettingRow or ListRow for row-local errors, EmptyState for a successful empty view, and a toast or dialog for something that needs a decision now.
- **Why:** A notice gives screen-wide conditions one clear location without misattributing them to a row. The banner is part of the layout grid, so drawers and panels start below it instead of being covered.
- **Source:** [VS Code Workspace Trust (Restricted Mode banner)](https://code.visualstudio.com/docs/editor/workspace-trust), [WAI-ARIA APG Alert](https://www.w3.org/WAI/ARIA/apg/patterns/alert/), [shadcn/ui Alert](https://ui.shadcn.com/docs/components/alert)

A message that belongs to the screen, not to one row: connection trouble, a failed action. A Thread in recovery wait is not a Notice: its reason and the one Retry are in the conversation status line (#103). `bad` for failures, `wait` for things in progress, plain otherwise. Say what happened and what to do; put the action in it. An optional semantic `icon` leads the text at `size-icon-small`.

## Banner

`banner` renders the application banner: a full-bleed row with no corners, `wait-bg` ground (the `wait` tone unless another is given), a `line` below, `space-4` × `space-12` padding, `type-caption` in `font-sans` and `fg`, the icon in `wait`. Place it as the first child of `.app`, above `.shell`, so the layout reserves its height; never overlay it. It holds one sentence in the UI language and at most one text link to the setting or guide that explains it, and no bordered button. It is `role="status"` (a static condition). The bridge supplies the fact; the design draws it.

Styles: style.css in this directory
