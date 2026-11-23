# WorkSheet

- **Use for:** Show the conversation right panel in a native modal sheet below 1180px, where it does not fit beside the conversation, and other modal flows; let the caller own open state and supply a dismissal-time focus target.
- **Do not use for:** Use PanelTabs for the desktop inspector, Popover for anchored controls and ThreadDeleteDialog for destructive confirmation.
- **Why:** Native modality confines focus and input; a scrollable body and explicit outside/Escape handling give the sheet one close path.
- **Source:** [WAI-ARIA APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/); [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog); [shadcn/ui Sheet](https://ui.shadcn.com/docs/components/sheet)

A native modal sheet, opened for the conversation right panel by the right-panel toggle
under 1180px. `open` alone drives
`showModal()` and `close()`. On dismissal, the sheet calls the supplied focus-target
getter then; it does not capture a DOM element during render or infer a fallback.
`showModal()` contains modal focus. The single `html:has(dialog:modal)` rule locks
document scrolling while the top-layer modal backdrop prevents input from reaching
the app panes; `.work-sheet-body` remains scrollable.

Only a primary pointer click whose coordinates are outside the dialog bounds dismisses
the sheet. Clicks on its padding, Ctrl+primary context clicks, and right-click do not.
Escape invokes the caller close path. The Button close action remains in the system
Button component path. The title and body are referenced through
`aria-labelledby`/`aria-describedby`.

References from the Reviewer audit: Radix `dialog:342,348` (outside pointer,
excluding right-click), `dialog:257` (scroll lock), shadcn/ui Sheet, and WAI-ARIA
APG Dialog (Modal) focus return.

Styles: style.css in this directory
