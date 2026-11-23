# WorkSheet

- **Use for:** Show Conversation Work in a native modal sheet; let the caller own open state and supply a dismissal-time focus target.
- **Do not use for:** Use PanelTabs for the desktop inspector, Popover for anchored controls and ThreadDeleteDialog for destructive confirmation.
- **Why:** Native modality confines focus and input; a scrollable body and explicit outside/Escape handling give the sheet one close path.
- **Source:** [WAI-ARIA APG Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/); [Radix Dialog](https://www.radix-ui.com/primitives/docs/components/dialog); [shadcn/ui Sheet](https://ui.shadcn.com/docs/components/sheet)

Only a primary click outside the dialog bounds dismisses; padding, right-click and
Ctrl+primary do not. Escape invokes the caller close path. Link the title and body through
`aria-labelledby` and `aria-describedby`. The document scroll lock leaves the sheet body
scrollable.

Styles: style.css in this directory
