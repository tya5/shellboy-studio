# Long-running foreground shell intervention: design study

Issue #134 is design-only. The mock uses static fixtures and local-only controls; it does not call Studio or Core. The only product actions represented are Core-owned `shell.stop`, `shell.write`, `shell.eof`, and message send with `deliver: now`. Moving a running shell to the background and interrupting only its Turn are clearly marked as pending Core issue #402; the mock disables those controls rather than implying they already work.

## References and applied patterns

- **VS Code integrated terminal:** its terminal tabs/actions keep each terminal identifiable and expose terminal-level management without confusing it with the editor or task. The mock makes the live shell a named row, then opens a focused drill-in for shell-specific actions. https://code.visualstudio.com/docs/terminal/terminals
- **JetBrains Run tool window:** run configurations and active processes have a dedicated tool window with explicit stop/rerun controls. The mock separates shell-level Stop from the Turn-level Stop and labels the object each affects. https://www.jetbrains.com/help/idea/run-tool-window.html
- **GitHub Actions workflow runs:** cancellation is an explicit run-scoped action rather than a generic global stop. The mock keeps Stop (the Run, in the composer) and Stop this shell (the shell, on its row and detail) as separate actions named by what they stop, with confirmation for the destructive shell stop. https://docs.github.com/en/actions/managing-workflow-runs/canceling-a-workflow
- **Material 3 segmented buttons:** one choice out of a few, with the chosen segment filled, is the system's ButtonGroup. The send timing is a two-segment choice (Next boundary, Now) above the composer, with a one-line explanation of the chosen timing beside it. A split button or a select was set aside: both hide the choice and its consequence behind a second step. https://m3.material.io/components/segmented-buttons/overview
- **WAI-ARIA APG menu button:** menu buttons expose their purpose and expanded state and support keyboard interaction. The shell row keeps the system row menu (ListRow with useRowMenu), with its trigger always visible instead of revealed on hover, so the shell actions are reachable by touch and pointer alike. https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/

## Proposal

The foreground shell is a one-line row in the Activity tab's Running section: command, `stdin` while it waits on standard input, elapsed time, and the `need-bg` waiting surface. Its always-visible row menu offers Send input…, Move to background (disabled, "Needs Core #402") and, after a separator, Stop this shell…. Selecting the row drills into Execution details in the same panel, with Back. The detail adds a "Waiting for input" group, shown only while the shell waits on standard input: the prompt line, a "Text to send" field, Send input (primary) and Send EOF. A "This shell" group holds Move to background (disabled, with the #402 note) and Stop this shell…, which asks for confirmation and says that the composer's Stop is separate and stops the whole Run.

While a shell holds the Turn in the foreground, a segmented send timing sits above the composer: Next boundary (default; the message arrives after the running shell returns, nothing is interrupted) or Now (`message send --deliver now`: the Turn stops waiting for the shell and reads the message now; the shell keeps running). The composer's control row stays one line: Interrupt Turn (disabled, Core #402) sits directly before the existing Stop, with a caption under the composer that says Interrupt Turn ends only this Turn and Stop still stops the Run.

At phone width the panel follows #128: the Thread panel sheet with the section picker, the full-screen detail with Back, and the confirmation as a sheet over it. Buttons in the detail are `size-touch` high.

Menu currently omits disabled entries. Showing Move to background disabled in the row menu needs Menu to render disabled entries with `aria-disabled`; until #402 lands the alternative is to leave it out of the menu and keep it only in the detail.

## Preview

From the `wip/studio-intervene-mock` branch, run `cd web && npm ci && npm run dev` and open `http://127.0.0.1:5173/intervene-mock.html` (use the port Vite prints). The page shows the Console (dark) and Light themes: two desktop frames (the row menu with Next boundary; the shell detail with Now) and four 390 px phone frames (conversation, section picker with the row menu, full-screen detail, Stop confirmation). The open menu and the confirmation over the detail are drawn statically so they can sit beside the other states; the rest uses the system components. Desktop and phone full-page captures are `web/designs/console/mocks/intervene-desktop.png` (1440 px) and `intervene-phone.png` (390 px).
