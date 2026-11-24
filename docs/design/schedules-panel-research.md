# Schedules in the Activity panel: design study

## Research

- **GitHub Actions scheduled workflows** presents schedules as workflow configuration, not an independent arbitrary task runner. Its event reference documents cron expressions and workflow-level scheduled triggers. The useful transfer is to keep cadence and timezone legible beside the scheduled item; do not imply that changing an entry changes application-level workflow configuration beyond the existing Core schedule. [Events that trigger workflows — `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- **cron-job.org** is a focused hosted cron manager: users manage a collection of URL jobs, inspect schedule/next execution and recent execution results, and open a job for configuration. Transfer its scannable job-list → selected-job detail structure and visible execution outcome. Do not copy URL-specific fields or claim Studio owns an independent scheduler. [cron-job.org](https://cron-job.org/en/)
- **Apple Shortcuts personal automations** frames an automation as a named trigger plus the actions that run, with a clear enabled/disabled lifecycle. Transfer a named row, understandable trigger summary, a detail surface, and explicit enable/disable. Studio shows Core's existing shell schedule/service records; it must not suggest that its controls edit Apple-style action graphs. [Create a personal automation in Shortcuts — Apple User Guide](https://support.apple.com/guide/shortcuts/create-a-personal-automation-apd690170742/mac)
- **Material 3 Lists** recommends predictable, aligned row content with a primary label and supporting metadata, and uses list rows to make many comparable entities scannable. Transfer stable one-line schedule rows with title, next run, last result, and enabled state; put less-frequent command/cwd facts in drill-in. [Lists — Material Design 3](https://m3.material.io/components/lists/overview)
- **shadcn/ui Data Table** builds tabular data on semantic columns and row actions, appropriate for dense administration on a wide viewport. Transfer the desktop column alignment and per-item actions, not a permanently wide table on a phone. A phone keeps the same facts in a compact one-line horizontal row where possible and preserves touch-sized actions; detail carries overflow. [Data Table — shadcn/ui](https://ui.shadcn.com/docs/components/data-table)

## Proposed pattern

Add a **Schedules** section within the existing conversation right-panel Activity tab. The first view is one row per existing Core time schedule and service, with four aligned facts: description (or a command fallback), next run, latest result/time, and enabled/paused. On wide screens, use a compact list with stable columns. At phone width, keep it a horizontally compact, single-line row with the title first; move the schedule expression and command into the detail if the viewport cannot preserve readable metadata. Do not make a second global scheduler screen.

Selecting a row opens a drill-in in the same panel, preserving the selected Thread and returning to the list on Back. Show schedule kind, cron or one-shot time, Core-local timezone semantics, next run, enabled state, latest execution state/exit code/time, output tail, cwd and command. Distinguish time schedules from services: services are read with Core's separate service-list operation, use service start/stop operations, and do not have a next occurrence; show their current running/stopped state in the next-run column's place. Explain that a settled one-shot disappears from the schedule list while its shell execution remains inspectable through existing shell readback.

Keep **Pause/Resume** (Core schedule disable/enable) and **Remove** reachable without hover, with touch-size targets: Pause/Resume is the row's enabled Switch, and Remove is a ghost icon in a fixed trailing column with the row-action geometry (24 px box, 28 px on phones, hit area extended to the row height), so every row's controls line up. Service rows map to Core service stop/start, not schedule disable/enable. Removing a scheduled command is destructive and may stop an active scheduled shell; require a confirmation naming the target and this consequence. There is no Core `schedule run now` command, so do not show Run now or simulate one. Each Core schedule/service list is capped at 64 entries. Core issue #399 proposes an opt-in per-Run model-request ceiling; this is not currently an implemented schedule invocation count, dollar limit, or external CLI budget. Studio only reads and invokes existing Core operations; no new scheduler semantics or commands are proposed.

The mock uses fixed fixture records and local-only interaction state. It does not connect to Core and does not run shell commands. Its pause/resume and remove actions demonstrate the proposed affordances only; they are not implementation claims.

## Open the mock

From the `wip/studio-schedules-mock` branch:

```sh
cd web
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/schedules-mock.html` (use the port Vite prints). The page shows the Console (dark) and Light themes. At a wide viewport it shows two desktop frames (the Activity list and the docked detail) and three 390 px phone frames (section picker and list, full-screen detail with Back, Remove confirmation); at phone width it shows only the phone frames. Rows are one line: name, next run (or the service state), the last-result mark, then the always-visible enabled switch and Remove. Selecting a row opens the detail; Back returns to the list. The page is static; no Studio service or owner is needed. Captures: `web/designs/console/mocks/schedules-desktop.png` and `schedules-phone.png`.
