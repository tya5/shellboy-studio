# LoadingRows

- **Use for:** Mark an in-flight read when the incoming row shape is known, such as not-yet-loaded spans of the conversation window.
- **Do not use for:** Use EmptyState for a settled empty view and Notice for failures.
- **Why:** Placeholders show the expected shape, announce one loading status and respect reduced motion.
- **Source:** 出典なし（この Studio で決めた）

Grey bars in place of content that is on its way, such as conversation rows outside the part already read. A slow pulse shows it's alive, and it stops under `prefers-reduced-motion`. Use it where the shape of what's coming is known; a spinner says less. Announced once as a status, not per bar.

Styles are colocated in `system/components/LoadingRows/style.css`.

Styles: style.css in this directory
