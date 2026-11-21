# ThreadDeleteDialog

A modal alert dialog for the exact singleton-delete preview and confirmation. The
row-menu selection passes the actual invoking control and a resolver for a nearby row
control; the generic sheet does not infer its opener from activeElement or row CSS.
It uses `role="alertdialog"`, ties the heading and concise confirmation text through
`aria-labelledby`/`aria-describedby`, and focuses the system Button Cancel control on
open. Outside pointer dismissal is disabled. Escape remains a cancellation path.
Modal focus is contained and app scroll boundaries are locked while open. Closing
returns focus to the original menu trigger or caller-resolved nearby control if the
row was removed.

Preview and confirmation policy remains fail-closed: confirmation requires
`deletable_now` and the exact `preview_marker`, passed unchanged. This follows Radix
`alert-dialog` and WAI-ARIA APG Alert Dialog.

References from the Reviewer audit: Radix `alert-dialog:117` (outside dismissal
blocked), `alert-dialog:109,115` (initial Cancel focus), and WAI-ARIA APG Alert
Dialog pattern.
