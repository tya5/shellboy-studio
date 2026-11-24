# Thread usage ranking mock

Static synthetic data only. No Core, bridge, provider, credentials or product entry point.

From `web/`, run `npm ci` and `npm exec -- vite . --host 127.0.0.1 --port 4185 --strictPort`, then open `http://127.0.0.1:4185/designs/console/mocks/cost-ranking.html`.

The 7-day view is the screenshot state; select a ranked row for the per-Thread destination mock, or 31 days for the incomplete-scan state. The destination demonstrates context and return, not integration with the existing view. Both screenshots are full-page renders from isolated headless Chrome, not physical-device evidence.
