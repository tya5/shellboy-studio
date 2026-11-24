# Static design mocks

Mocks are design-only previews built from the system components and tokens. They use fixture data and local state; their interactions never call Studio or Core.

Open one with `cd web && npm ci && npm run dev`, then `http://127.0.0.1:5173/<name>-mock.html` (use the port Vite prints). Each page shows the Console (dark) and Light themes; at a wide viewport it shows desktop frames and 390 px phone frames side by side, and at phone width only the phone frames. `frame.tsx` holds the shared page scaffolding; product screens never import it.

- **Branches (#138):** `branches-mock.html`. A Thread's lines of work as coloured vertical lanes with split points, the two picked lines compared from their split, and New branch / Rewind on a selected message (Rewind marks what leaves and lists the dry-run facts first). At phone width the lane graph stays a full-width list, a tapped message opens its actions under it, and Compare opens a stacked view. Captures: `branches-desktop.png` (1440 px) and `branches-phone.png` (390 px, laid out at a true 390 px viewport through the DevTools protocol, since headless Chrome's window is at least 500 px wide). Sources and rationale: `docs/design/branches-redesign-research.md`.
