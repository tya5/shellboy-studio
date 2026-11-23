# MonitorPopover

- **Use for:** Open nondestructive Monitor display controls from a local toolbar trigger; click persists and optional hover/focus only previews.
- **Do not use for:** Use Menu for short row actions and a dialog for confirmation.
- **Why:** Preview can close without moving focus; Escape or outside press dismisses the panel, and a persistent panel can return focus to its trigger.
- **Source:** [Radix Hover Card Escape behavior, as recorded in the Studio audit](https://github.com/tya5/shellboy-studio/commit/833470949af0d0ff59bc85b580fdb9c93c4e4155)

A local toolbar popover for Monitor display controls. Click toggles its persistent
open state; optional hover/focus preview is transient. Escape closes hover previews without stealing focus;
when a click-opened panel is closed, focus returns to its trigger. Outside pointer closes the
persistent panel. Use for nondestructive local settings, not confirmations.

Reference: Radix `hover-card:334` handles Escape while the surface is open/hovered.

Styles: style.css in this directory

The controlled form uses the same dismissal and focus behavior for an owner-scoped
picker. Its caller owns the open state and may supply the existing panel style.
