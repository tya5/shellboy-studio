# MonitorPopover

A local toolbar popover for Monitor display controls. Click toggles its persistent
open state; optional hover/focus preview is transient. Escape closes hover previews without stealing focus;
when a click-opened panel is closed, focus returns to its trigger. Outside pointer closes the
persistent panel. Use for nondestructive local settings, not confirmations.

Reference: Radix `hover-card:334` handles Escape while the surface is open/hovered.

Styles: style.css in this directory

The controlled form uses the same dismissal and focus behavior for an owner-scoped
picker. Its caller owns the open state and may supply the existing panel style.
