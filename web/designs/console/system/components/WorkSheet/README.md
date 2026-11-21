# WorkSheet

A native modal sheet for the Conversation work strip. `open` alone drives
`showModal()` and `close()`. On dismissal, the sheet calls the supplied focus-target
getter then; it does not capture a DOM element during render or infer a fallback.
`showModal()` contains modal focus. The single `html:has(dialog:modal)` rule locks
document scrolling while the top-layer modal backdrop prevents input from reaching
the app panes; `.work-sheet-body` remains scrollable.

Only a primary pointer click whose coordinates are outside the dialog bounds dismisses
the sheet. Clicks on its padding, Ctrl+primary context clicks, and right-click do not.
Escape invokes the caller close path. The Button close action remains in the system
Button component path. The title and body are referenced through
`aria-labelledby`/`aria-describedby`.

References from the Reviewer audit: Radix `dialog:342,348` (outside pointer,
excluding right-click), `dialog:257` (scroll lock), shadcn/ui Sheet, and WAI-ARIA
APG Dialog (Modal) focus return.
