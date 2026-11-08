# Studio #4: Explicit No-Auth Candidate

Base: audited publiccandidate `7dfab921`, independent branch. No live/readback or
private-main changes are included. Initial-release adoption and runtime activation
remain separate leader decisions. This document is evidence, not an assertion of
independent review/privacy-audit approval.

## Authentication Boundary

- Default Auth::new/load_or_create, token exchange and cookie validation remain.
- Only explicit CLI --no-auth constructs Auth::disabled; no token file is loaded
  or created. Protected routes skip token/session checks but not Host/Origin.
- Host policy is unchanged for every route. Origin checks guard /auth-mode,
  /auth, /pairing, /pairing/exchange, /guide-preference and /ws. Absent Origin
  retains the existing non-browser policy. No forwarded header is trusted, no
  wildcard or arbitrary Origin is added, and sandbox static app routes retain
  their existing capability/CORS checks. Unknown paths do not become RPC routes.
- /auth-mode is a no-store public single configuration bit, not an owner call,
  authenticated data response, credential or session issuance surface. Wrong
  Host/Origin is rejected. Failed/unknown bootstrap does not assert a mode.
- No-auth /auth responds 204 to the existing valid JSON request, issuing no
  cookie. Pairing returns 409, issuing/exchanging no credential. Default pairing
  and session tests still run. No-auth does not disable app capability checks.
- The UI reads mode at bootstrap and on connection open (no polling/task queue).
  A generation scalar drops obsolete responses; one fixed badge is retained,
  not one per reconnect, and explicit authenticated mode removes it. It lives
  outside swappable presentation, with reserved viewport space on mobile. The
  optional debug page displays its own warning. Network failures remain unknown.
- CLI warning and guide say tailnet-only Serve, NEVER Funnel, shared tailnet
  users and same-PC processes can operate the bridge. No automated guarantee or
  network configuration change is made.

## Commands And Observations

Environment: local macOS, synthetic mock Owner only. Cargo uses a temporary CLI
patch to existing local Core `release-owner-main` at `8951571152`; no manifest or
lockfile change is retained and no Core installation/pin is performed. Commands
run through rust-slot with Core work taking priority.

- cargo fmt: success.
- cargo --config 'patch."https://github.com/tya5/shellboy".shellboy.path="../release-owner-main"' test --test bridge no_auth:
  2 passed. Loopback and allowed proxy Host/Origin, auth on/off, wrong Host and
  cross-Origin, HTTP/WS, no-cookie auth/pairing, exact bootstrap bit are exercised.
- Same patched cargo test --bin shellboy-studio: 4 passed, including explicit
  CLI/default/allow-host composition.
- Same patched cargo test --test apps: 13 passed. App sandbox/capabilities remain.
- Same patched cargo check --tests: success (including default feature compile).
- Full bridge test run: 11 passed, 2 existing event-distribution tests timed out
  waiting for frames: new_tabs_start_from_the_current_owner_state_and_hear_about_changes
  and hints_reach_only_the_tabs_that_watch_and_resync_reaches_all. These are NOT
  claimed green or proven pre-existing failures. Authentication/session/pairing
  tests in that run passed. Review/release gating must account for this gap.
- cd web && npm run check: 41 files / 636 tests passed (both TS configurations).
- cd web && npm run build: success. No dependency/toolchain change.
- node web/designs/console/test/browser/no-auth-serve.mjs and no-auth-check.mjs:
  synthetic production bundle, exact existing bridge CSP, 1280/390 viewport widths.
  Fixed badge top=0, height=24, reserved root top=25, no horizontal overflow,
  remains on scroll. Screenshots are private local artifacts, not repository
  content. Device emulation is not a phone test. Synthetic server deliberately
  has no /ws, so expected WebSocket 404 logs are not connectivity evidence.

Not tested: actual tailnet/Serve/Funnel, phone hardware, installed/published Core
pairing, real owner/data/API, actual CLI startup against an owner, independent
security/privacy review. The focused Rust test does perform real HTTP and WS
handshakes against a disposable mock bridge, not a production owner.
