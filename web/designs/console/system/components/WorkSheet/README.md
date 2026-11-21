# WorkSheet

A native modal sheet for the Conversation work strip. The caller passes the actual
invoking control and a nearby-focus resolver; the sheet never guesses focus from
mount-time activeElement or inspects row classes. `showModal()` contains modal focus.
While open, `modal-dialog-open` prevents scrolling in the app's `.side`, `.scroll`,
`.mon`, and `.org` scroll containers, while `.work-sheet-body` remains scrollable.

Only a primary pointer click whose coordinates are outside the dialog bounds dismisses
the sheet. Clicks on its padding, Ctrl+primary context clicks, and right-click do not.
Escape invokes the caller close path. The Button close action remains in the system
Button component path. The title and body are referenced through
`aria-labelledby`/`aria-describedby`. On close, return focus to the passed opener, or
ask the caller's resolver when it has been removed.

References from the Reviewer audit: Radix `dialog:342,348` (outside pointer,
excluding right-click), `dialog:257` (scroll lock), shadcn/ui Sheet, and WAI-ARIA
APG Dialog (Modal) focus return.
