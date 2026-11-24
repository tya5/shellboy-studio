# ThreadTagEditor

Edits one Thread's tags from its existing sidebar row-menu action. It resolves the current row from the live owner-backed row signal, so accepted tag changes appear after owner hints without a separate source of truth. Uses the standard Section, Field, ButtonGroup and Notice patterns.

- **Place:** in the app alert/perimeter region opened by the sidebar row action; it stays aligned with page content.
- **Do not use for:** multi-Thread tag editing; that action was intentionally removed with the Threads organizer (#138).
