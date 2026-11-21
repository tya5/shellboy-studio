# ThreadDeleteDialog

A modal alert dialog for the exact singleton-delete preview and confirmation. It uses
`role="alertdialog"`, ties its title and concise confirmation text with
`aria-labelledby`/`aria-describedby`, and focuses Cancel on open. Outside click and
Escape do not dismiss it; the user must use Cancel or the enabled confirm action.
Native modal dialog behavior contains focus and locks page scrolling. Closing returns
focus to the opener, with nearby-row fallback if the opener has been removed.

Preview and confirmation policy remains fail-closed: confirmation requires
`deletable_now` and the exact `preview_marker`, passed unchanged. References from the Reviewer audit: Radix `alert-dialog:117` (outside dismissal
blocked), `alert-dialog:109,115` (initial Cancel focus), and WAI-ARIA APG Alert
Dialog pattern. The sheet/dialog must not
be used to bypass delete preview or confirmation requirements.
