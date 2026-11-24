# MonitorPopover

Shared accessible popover behavior retained for existing toolbar and model-picker controls. The legacy component name is kept to avoid unrelated API churn (#138); this component does not render or own a Monitor screen.

- **Use for:** A local toolbar or picker popover that needs outside-click and Escape dismissal.
- **Placement:** Next to the control that opens it.
- **Do not use for:** Modal confirmation or long workflows; use a dialog or page-level component.

Styles: shared popover rules in `../shared/popover.css`.
Styles: style.css in this directory.
