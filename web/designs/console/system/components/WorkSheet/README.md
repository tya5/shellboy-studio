# WorkSheet

A modal native-dialog sheet for the Conversation work strip. `showModal()` provides
modal focus containment and Escape cancellation. The sheet locks document scrolling
while open. A primary-button backdrop click dismisses it; a contextmenu/right-click
does not. Escape follows the same caller-controlled close path. The heading ID names
the dialog with `aria-labelledby`; the body (or supplied concise description) is
referenced by `aria-describedby`. Closing returns focus to the element active at
opening; if that row opener has been removed, focus moves to an adjacent row control.

References from the Reviewer audit: Radix `dialog:342,348` (outside pointer,
excluding right-click), `dialog:257` (scroll lock), shadcn/ui Sheet, and WAI-ARIA
APG Dialog (Modal) focus return. Keep the
sheet content scoped to compact task inspection, not a full-page workflow.
