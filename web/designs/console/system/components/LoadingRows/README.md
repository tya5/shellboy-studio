# LoadingRows

- **Use for:** An in-flight read whose shape is known: LoadingRows for rows and section bodies (such as not-yet-loaded spans of the conversation window), LoadingCount for a count that has not been read yet.
- **Do not use for:** Use EmptyState for a settled empty region and Notice for failures. Never show "0" or "Showing 0 of 0" before the first read settles; "0" means a read finished and found nothing.
- **Why:** Placeholders show the expected shape without stating a number that was never measured. They announce one loading status and respect reduced motion.
- **Source:** [shadcn/ui Skeleton](https://ui.shadcn.com/docs/components/skeleton), [Material 3 Progress indicators](https://m3.material.io/components/progress-indicators/overview)

`LoadingRows` draws grey bars in place of content that is on its way. A slow pulse shows it's alive, and it stops under `prefers-reduced-motion`. Use it where the shape of what's coming is known; a spinner says less. Announced once as a status, not per bar.

`LoadingCount` is a fixed-width skeleton (`3ch`, three digits; a width in characters, not pixels) in the count's slot, as high as the line it replaces (`1lh`), or `size-chip-height` with `small` (inside a compact count chip). Surface `raised`; pass `onRaised` inside a ButtonGroup or any other `raised` surface, which draws it in `line`, corners `radius-s`, the same pulse as LoadingRows. It is `aria-hidden`; mark the owning control `aria-busy="true"` while it shows.

A section or page action keeps its action label while a read runs (for example "Refresh", never "Reading"): disable it and put a `role="status"` line such as "Reading…" in `type-caption` `muted` beside it.

Styles: style.css in this directory
