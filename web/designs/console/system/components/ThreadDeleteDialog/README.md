# ThreadDeleteDialog

- **Use for:** Confirm an exact single-Thread or selected-set delete preview in a modal alert dialog with Cancel initially focused.
- **Do not use for:** Use Menu for the action trigger; use a ghost action in SelectionBar for a selected set; do not use this for generic notices.
- **Why:** The preview and unchanged marker fail closed; preventing outside dismissal and restoring the row focus keeps the destructive action deliberate.
- **Source:** [WAI-ARIA APG Alert Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/); [Radix Alert Dialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog)

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

Styles: style.css in this directory

For a selected set (#36), the sheet retains focus while a single atomic request
is pending. It re-reads the exact set when its selection or saved owner targets
change and never commits a refreshed preview automatically. It displays the
requested IDs, per-target blockers and scheduled stops. Cancel returns focus
to the selection bar Delete control or the sidebar heading if it is gone.
