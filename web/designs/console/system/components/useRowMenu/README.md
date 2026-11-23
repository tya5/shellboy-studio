# useRowMenu

- **Use for:** Give each actionable row its own Menu state, trigger and pointer or keyboard anchor.
- **Do not use for:** Use MonitorPopover for toolbar controls and ThreadDeleteDialog for confirmation; don't introduce a shared row-menu registry.
- **Why:** Local ownership keeps placement and focus return tied to the row and routes dismissal through one Popover layer.
- **Source:** [Studio row actions (shadcn/ui, Radix, APG)](../../patterns/row-actions.md)

Styles: style.css in this directory
