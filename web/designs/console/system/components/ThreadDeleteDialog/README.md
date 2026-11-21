# ThreadDeleteDialog

A modal alert dialog for the exact singleton-delete preview and confirmation. The
screen supplies the target thread id and an id-based getter for its row link. The
sheet invokes that getter at dismissal, after closing; Cancel therefore returns to
the still-present row link. Delete closes synchronously before starting the request.
The request result updates only the notice and never moves focus.

When a row is removed, the list that renders it owns focus recovery while it still
holds a focus claim for that row. The claim is set on row focus and cleared when focus
leaves the list; if the claimed row disappears, the list advances to the next row link
or its heading. This also covers archive and filter removals.

It uses `role="alertdialog"`, ties the heading and concise confirmation text through
`aria-labelledby`/`aria-describedby`, and focuses the system Button Cancel control on
open. Outside pointer dismissal is disabled. Escape remains a cancellation path.
Modal focus is contained and app scroll boundaries are locked while open.

Preview and confirmation policy remains fail-closed: confirmation requires
`deletable_now` and the exact `preview_marker`, passed unchanged. This follows Radix
`alert-dialog` and WAI-ARIA APG Alert Dialog.

References from the Reviewer audit: Radix `alert-dialog:117` (outside dismissal
blocked), `alert-dialog:109,115` (initial Cancel focus), and WAI-ARIA APG Alert
Dialog pattern.
