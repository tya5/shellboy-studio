# Static design mocks

Mocks are design-only previews built from the system components and tokens. They use fixture data and local state, and their interactions never call Studio or Core.

To open one, run `cd web && npm ci && npm run dev`, then go to `http://127.0.0.1:5173/<name>-mock.html` (use the port Vite prints). Each page shows the Console (dark) and Light themes. At a wide viewport it shows desktop frames and 390 px phone frames side by side; at phone width it shows only the phone frames. `frame.tsx` holds the shared page scaffolding, and product screens never import it.

- **Core management (#141):** `core-management-mock.html`. Settings › Core with the status summary, the live Runs and shells, the owner facts and the supervision rule. Restart, Stop and Start sit in the page header, and the desktop status bar entry and the banner link to this page. The states are: running, starting (the Core #398 stage), stopped by the user, exited unexpectedly and started again once, restart pending, the Restart and Stop confirmations, and a browser attached to a Core started outside Studio. Frames are window-sized and start at the top; the running and outside-Studio rows show the whole page.
  - **Captures:** `core-management-desktop.png` and `core-management-desktop-light.png` (1440 px), and `core-management-phone.png` and `core-management-phone-light.png` (390 px). Each capture holds one theme (`?theme=dark` or `?theme=light`), so the page stays under the browser's texture limit.
  - **How they were made:** with the Chrome DevTools protocol (`Emulation.setDeviceMetricsOverride` at the target width, then `Page.captureScreenshot` with `captureBeyondViewport`). The 390 px capture is laid out at a true 390 px viewport, since headless Chrome's window is at least 500 px wide.
  - **Sources and rationale:** `docs/design/core-management-research.md`.
