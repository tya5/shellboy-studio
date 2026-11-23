# EmptyState

- **Use for:** Show a semantic icon, what belongs here and how it fills up when a view is genuinely empty.
- **Do not use for:** Use LoadingRows during an active read and Notice when a read fails.
- **Why:** An explanation distinguishes an empty result from a missing or broken region.
- **Source:** 出典なし（この Studio で決めた）

What an empty view shows: an icon, one line naming what belongs here and one line
saying how it fills up. Supply the semantic `IconRole` for the empty condition (such
as `empty.inbox`), not a glyph name. The role-to-shape choice stays inside the Icon
theme. Never render a bare blank region.

Styles are colocated in `system/components/EmptyState/style.css`.

Styles: style.css in this directory
