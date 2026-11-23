# OutputLimitNotice

A neutral `role=status` row directly below a partial assistant reply when Core reports a provider output-limit stop. It presents concise explanatory text and explicit actions; use it only for this conversation-level stop, not for context limits or ordinary errors. Keep the status and actions together, and allow the actions to wrap on narrow screens.

Pattern: inline status message with explicit actions, following the WAI-ARIA status-message role and the approved Studio #74 mock.

Styles: style.css in this directory.

Design-system debt: none.
