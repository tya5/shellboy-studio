# Bridge and debug page (foundation, part 1)

Status: implemented (2026-11-07), local only. Refines `architecture.md` §2 to §5; where
they differ, the architecture document records the decision and this file records how the
code does it.

## What exists

- `shellboy-studio` binary and library crate (`src/`): HTTP + WebSocket bridge to a running
  owner. `GET /` and `GET /assets/*` serve the production frontend, embedded from `web/dist`
  by `build.rs` (`include_bytes!`, no extra crate). `index.html` is `no-cache`, hashed assets are
  immutable, and the CSP allows only the bridge's own origin. Build order: `npm ci && npm run
  build` in `web/`, then `cargo build`. Without a build the bridge still compiles, and `GET /`
  answers 503 with how to make one. Built assets are not committed.
- `web/debug/index.html`: the debug page, one static file embedded into the binary
  (`include_str!`), plain JavaScript, no build step. It is a separate entry from the
  future app bundle. Served at `/debug` only with `--debug`; otherwise the route does not
  exist (404).

## Run

```sh
shellboy serve --data-dir DIR &      # an owner must run (a TUI owner also works)
shellboy-studio --data-dir DIR          # prints http://127.0.0.1:8751/#token=...
shellboy-studio --data-dir DIR --debug  # also serves /debug
```

Open the printed URL once; the app exchanges the token the same way. For the debug page, open the printed `debug page:` URL; the page posts the token to `/auth`, gets an
`HttpOnly; SameSite=Strict` cookie and drops the fragment. Flags: `--listen ADDR`
(default `127.0.0.1:8751`), `--data-dir` (default: `SHELLBOY_DATA_DIR`, then the OS
default, resolved by Shellboy's own `resolve_cli_data_dir`), `--config-dir` (token
location, default the OS config directory plus `shellboy-studio`), `--allow-host NAME`
(repeatable), `--apps-dir` (default `apps` in the data directory, `apps.md`), `--debug`. Apps are served on this same port, under `/a/`.

## Bounds (limits, not performance claims)

| What | Bound | Owner / end |
|---|---|---|
| Owner connections for hints | exactly 1 `events.wait` in flight | `events::run` task; ends on the cancellation token (dropping the call closes its connection) |
| Proxied owner calls, global | 8 (`server::GLOBAL_CALLS`) | semaphore in `Shared` |
| Proxied calls per session | 4 running + 32 waiting, then `busy` (`ws::SESSION_*`) | tasks in the session's `JoinSet`; aborted when the socket closes |
| Browser sessions | 64 (`hub::MAX_SESSIONS`), then HTTP 503 | `Hub`; removed by `SessionGuard::drop` |
| Watched Threads per tab | 64 | per-session set; the dirty set is a subset of it plus flags |
| Hints per tab | no queue: one coalesced `Pending` (dirty set, list flag, resync flag, latest owner event) | merged on every update, flushed as one `changed` frame |
| Incoming WebSocket frame | 24 MiB, for an app's `data.write` | axum limit |
| Session cookies in memory | 256, oldest evicted | `Auth` |
| Poll backoff after an owner error | 250 ms doubling to 10 s, no cursor kept | `events::PollConfig` |

The 30 s long-poll length is the design's value, not a promise about latency.

## Behaviour of the shared long-poll

One `events.wait{after, thread_ids: [], timeout_ms: 30000}` loop. `baseline`/`timeout`:
keep the cursor. `changed`: mark the listed Threads dirty for tabs that watch them and set
the list flag for tabs that show the list; `more` makes the next call use timeout 0.
`resync_required`: every tab gets `resync`. Any error (owner gone, shutdown, bad cursor,
undecodable result): tabs get `owner: unreachable` once, the cursor is dropped, the loop
retries with backoff, and the first success is `owner: connected` (or `restarted` if the
instance differs, taken from the operation-ID prefix of the reply as `shellboy chat`
does) followed by `resync`. The loop never reads Thread facts and there is no polling
fallback.

## Seams

`src/seam.rs` is the only place that knows about work not on Shellboy main:

- Protocol 3 / `Welcome.capabilities` (#244 A2): `owner_capabilities()` returns an empty
  list now. `hello` and `owner` frames already carry `capabilities`.
- Live text deltas (E3): `decode_events_result()` decodes the long-poll result strictly as
  `EventsWaitResult` and returns `(result, Vec<StreamChunk>)` with an always-empty vector.
  The browser `stream` frame exists in `envelope.rs` but nothing sends it. The wire shape
  on the owner side is deliberately not guessed: a new field currently fails decoding
  loudly (the bridge reports the owner unreachable with the reason on stderr).

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| Depend on Shellboy `origin/main` `fa7bec02c0` by git `rev`, not a tag | `events.wait` is not in v0.9.0; no later tag | a tag containing `events.wait` exists |
| `/debug` page is served without a session; all data arrives over the authenticated `/ws` | the page is static and holds nothing; it doubles as the token form. Requests still pass the Host check | the page gains embedded data |
| `Origin` absent is accepted on `/auth` and `/ws`; present must equal `Host` | browsers always send it on the risky requests; non-browser clients (tests, curl) need not | a non-browser threat appears |
| Cookie named by the bridge's port, `sbw_session_<port>` | cookies ignore ports, so bridges on one host would overwrite each other's sessions. A port is unique per host, and a browser sends a bridge only its own name | a bridge moved to another port asks for the token again |
| Bridges may share `--config-dir`, and so the token | the token is all that's there. Each bridge keeps its own sessions, so signing in to one doesn't sign in to the other. Preferences are per origin, so per bridge | separate `--config-dir` for a separate token |
| Session cookie is a random id kept in memory, not signed | no HMAC dependency; a bridge restart asks for the token again | restarts become a nuisance |
| No `Secure` attribute on the cookie | the bridge cannot know whether a TLS tunnel is in front | built-in TLS or a trusted-proxy setting |
| `read_only`, `token rotate` opt-outs not built yet | not needed by the foundation | before first release |
| Ephemeral `message.send` fields: the bridge forces `human: true`, `sender_label: "web"` | architecture 4.4 | never |
| Debug page UI is plain JS, not the TS data layer | the data layer is part 2; the debug page must work without it | the data layer exists (then the debug page may show its state) |

## Allowlist additions

`usage.get`, `compact.list`, `storage.status` and `index.status` are reads for the Analytics and Settings views (`analytics-settings.md`). `src/ws.rs` tests that they pass and that `storage.collect`, `index.*` mutations, `thread.prune`, `thread.set` and `compact` stay denied.

## Memory (measured, 2026-11-07)

A fact of one run, not a bound. `ps -o rss=` sampled every 200 ms; debug build, macOS arm64, temp owner with 5,002 Threads and a 100,000-node Thread. Idle: 5 to 13 MiB depending on what it has served. One tab opening the long Thread (1,002 `history.list` calls): peak 15 MiB. Four tabs doing that at once: peak 15 MiB. Analytics > Memory shows the same figure on opening and on Refresh (`bridge.memory`, `src/process.rs`): `/proc` on Linux, `ps` on other Unix, unknown on Windows with the reason stated. A release build wasn't measured. The worst case isn't this: replies pass through unbuffered per call, so up to 8 proxied calls of up to the 8 MiB frame limit could be in memory at once.

## Needs from core

See the hand-off report; nothing blocks part 1. Items that would help: a way to obtain
the owner's `instance_id`, protocol version and capabilities without a request
(today it is read from the operation-ID prefix), `Welcome.capabilities` (A2), and a
Shellboy tag that contains `events.wait`.

## Validation record (2026-11-07)

Environment: macOS (Darwin 25.3, arm64), toolchain 1.99.1, debug build, Shellboy `fa7bec02c0`.
Commands (via rust-slot, `CARGO_TARGET_DIR=target-web`): `cargo clippy --all-targets -- -D warnings`
(clean), `cargo test` with `SHELLBOY_BIN` set to a `shellboy` binary built from the same revision.

- 7 unit tests (hub coalescing and bounds, auth/host/origin rules, call decoding and allowlist).
- 5 loop tests against a scripted owner (cursor kept, `more` drained with timeout 0, resync,
  unreachable with backoff then reconnect, restart detection, one poll in flight).
- 6 bridge tests over a real TCP listener with a WebSocket client (guards, proxy, allowlist,
  `human`/`web` marking, per-session `busy` and cancel, hint routing, owner state on connect).
- 1 real-owner test: `shellboy serve` with a temporary data directory, temporary HOME/XDG and
  a config pointing at an unused loopback port (no model call, no network, no credentials):
  `thread.create` through the proxy gives a `changed` list hint (one sample: 4.4 ms, not a
  bound), `thread.list` shows the Thread, owner shutdown gives `unreachable`, a new owner on the
  same data directory gives `restarted` then `resync` with a new instance id.
- Smoke of the built binary against a real owner: `/debug` 200 with `--debug`, wrong Host 403,
  `/ws` without cookie 401, `/auth` 204, token file mode 0600. The debug page script passes
  `node --check`.

Not done: the debug page has not been opened in a browser (no browser automation, no
Playwright); its behaviour is unverified beyond syntax and the frames it relies on being
covered by the bridge tests. Not tested: Linux, Windows, phone, LAN binding, TLS tunnel, several
hundred hints per second, concurrent real tabs, `message.send` with a real provider.

`thread.branches` (read), `thread.fork`, `thread.rewind` and `thread.unarchive` (mutations) serve the Branches and Threads views (`branches-threads.md`). A rewind dry run is the same command with `dry_run: true` and no operation id. `tests/real_owner.rs` drives them against a real owner with a loopback provider.
