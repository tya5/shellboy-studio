# Long-running foreground shell intervention: design study

Issue #134 is design-only. The mock uses static fixtures and local-only controls; it does not call Studio or Core. The only product actions represented are Core-owned `shell.stop`, `shell.write`, `shell.eof`, and message send with `deliver: now`. Moving a running shell to the background and interrupting only its Turn are clearly marked as pending Core issue #402; the mock disables those controls rather than implying they already work.

## References and applied patterns

- **VS Code integrated terminal:** its terminal tabs/actions keep each terminal identifiable and expose terminal-level management without confusing it with the editor or task. The mock makes the live shell a named row, then opens a focused drill-in for shell-specific actions. https://code.visualstudio.com/docs/terminal/terminals
- **JetBrains Run tool window:** run configurations and active processes have a dedicated tool window with explicit stop/rerun controls. The mock separates shell-level Stop from the Turn-level Stop and labels the object each affects. https://www.jetbrains.com/help/idea/run-tool-window.html
- **GitHub Actions workflow runs:** cancellation is an explicit run-scoped action rather than a generic global stop. The mock uses separate adjacent actions for Stop Turn and Stop this shell, with confirmation for the destructive shell stop. https://docs.github.com/en/actions/managing-workflow-runs/canceling-a-workflow
- **Material 3 split buttons:** a primary action stays available while a companion control exposes a related choice. The composer keeps Send prominent and puts the delivery timing in a labeled native select beside it, defaulting to Next boundary. https://m3.material.io/components/split-button/overview
- **WAI-ARIA APG menu button:** menu buttons expose their purpose and expanded state and support keyboard interaction. Where a menu would add friction to a frequent timing choice, the mock uses a labeled native select rather than a custom menu; shell operations stay visible, touch-sized actions, never hover-only. https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/

## Proposal

The current foreground shell appears as a row with command, elapsed time, and waiting/running state. Selecting it drills into a shell-specific detail view. The detail offers Move to background (disabled and marked Core #402), Stop this shell (confirmation), and, only when stdin is waiting, an input field with Send input and EOF. The composer adds a timing select: Next boundary (default; queues for the next safe delivery boundary) or Now (releases the foreground wait). Short helper text explains the difference. Interrupt Turn appears next to existing Stop and is disabled and marked Core #402. Stop Turn remains separate from Stop this shell. Every action is visible on touch layouts.

## Preview

From the `wip/studio-intervene-mock` branch, run `cd web && npm ci && npm run dev` and open `http://127.0.0.1:5173/intervene-mock.html`. The static preview is isolated from the product app and uses only existing system components/tokens. Desktop and phone full-page captures are `web/designs/console/mocks/intervene-desktop.png` and `intervene-phone.png`.
