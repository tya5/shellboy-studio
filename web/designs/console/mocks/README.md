# Static design mocks

Mocks are design-only previews built from the system components and tokens. They use fixture data and local state; their interactions never call Studio or Core.

Open one with `cd web && npm ci && npm run dev`, then `http://127.0.0.1:5173/<name>-mock.html` (use the port Vite prints). Each page shows the Console (dark) and Light themes; at a wide viewport it shows desktop frames and 390 px phone frames side by side, and at phone width only the phone frames. `frame.tsx` holds the shared page scaffolding; product screens never import it.

- **Schedules panel (#131):** `schedules-mock.html`. Activity tab with Schedules and Services sections, the docked detail drill-in, and at phone width the section picker, the full-screen detail with Back and the Remove confirmation. Captures: `schedules-desktop.png` (1440 px) and `schedules-phone.png` (390 px). Sources and rationale: `docs/design/schedules-panel-research.md`.
