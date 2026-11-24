# Static design mocks

Mocks are design-only previews built from the system components and tokens. They use fixture data and local state; their interactions never call Studio or Core.

Open one with `cd web && npm ci && npm run dev`, then `http://127.0.0.1:5173/<name>-mock.html` (use the port Vite prints). Each page shows the Console (dark) and Light themes; at a wide viewport it shows desktop frames and 390 px phone frames, and at phone width only the phone frames. `frame.tsx` holds the shared page scaffolding; product screens never import it.

- **Foreground shell controls (#134):** `intervene-mock.html`. The running shell row and its menu, the shell detail with input/EOF and shell actions, the composer send timing and Interrupt Turn beside Stop, and at phone width the section picker, the full-screen detail and the Stop confirmation. Captures: `intervene-desktop.png` (1440 px) and `intervene-phone.png` (390 px). Sources and rationale: `docs/design/intervene-shell-research.md`.
