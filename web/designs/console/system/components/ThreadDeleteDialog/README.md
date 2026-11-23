# ThreadDeleteDialog

- **Use for:** Confirm a single exact delete preview in a modal alert dialog with Cancel initially focused.
- **Do not use for:** Use Menu for the action trigger; do not reuse this for bulk deletion or generic notices.
- **Why:** The preview and unchanged marker fail closed; preventing outside dismissal and restoring the row focus keeps the destructive action deliberate.
- **Source:** [WAI-ARIA APG Alert Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/); [Radix Alert Dialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog)

Require `deletable_now` and pass the exact `preview_marker` unchanged. Escape cancels. Keep
the alert heading and confirmation text linked through `aria-labelledby` and
`aria-describedby`. Close before starting Delete; only the notice reacts to the result.
Resolve the row link at dismissal. The containing list advances focus after removal only while
its claim is still active.

Styles: style.css in this directory
