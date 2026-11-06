# Bridge and debug page (foundation, part 1)

Status: implemented (2026-11-07), local only. Refines `architecture.md` §2 to §5; where
they differ, the architecture document records the decision and this file records how the
code does it.

## What exists

- `shellboy-web` binary and library crate (`src/`): HTTP + WebSocket bridge to a running
  owner. No frontend beyond the debug page; `GET /` is a plain text placeholder.
- `web/debug/index.html`: the debug page, one static file embedded into the binary
  (`include_str!`), plain JavaScript, no build step. It is a separate entry from the
  future app bundle. Served at `/debug` only with `--debug`; otherwise the route does not
  exist (404).

## Run

```sh
shellboy serve --data-dir DIR &      # an owner must run (a TUI owner also works)
shellboy-web --data-dir DIR --debug  # prints http://127.0.0.1:8751/#token=...
```

Open the printed `debug page:` URL once; the page posts the token to `/auth`, gets an
`HttpOnly; SameSite=Strict` cookie and drops the fragment. Flags: `--listen ADDR`
(default `127.0.0.1:8751`), `--data-dir` (default: `SHELLBOY_DATA_DIR`, then the OS
default, resolved by Shellboy's own `resolve_cli_data_dir`), `--config-dir` (token
location, default the OS config directory plus `shellboy-web`), `--allow-host NAME`
(repeatable), `--debug`.

## Bounds (limits, not performance claims)

| What | Bound | Owner / end |
|---|---|---|
| Owner connections for hints | exactly 1 `events.wait` in flight | `events::run` task; ends on the cancellation token (dropping the call closes its connection) |
| Proxied owner calls, global | 8 (`server::GLOBAL_CALLS`) | semaphore in `Shared` |
| Proxied calls per session | 4 running + 32 waiting, then `busy` (`ws::SESSION_*`) | tasks in the session's `JoinSet`; aborted when the socket closes |
| Browser sessions | 64 (`hub::MAX_SESSIONS`), then HTTP 503 | `Hub`; removed by `SessionGuard::drop` |
| Watched Threads per tab | 64 | per-session set; the dirty set is a subset of it plus flags |
| Hints per tab | no queue: one coalesced `Pending` (dirty set, list flag, resync flag, latest owner event) | merged on every update, flushed as one `changed` frame |
| Incoming WebSocket frame | 1 MiB | axum limit |
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
| Session cookie is a random id kept in memory, not signed | no HMAC dependency; a bridge restart asks for the token again | restarts become a nuisance |
| No `Secure` attribute on the cookie | the bridge cannot know whether a TLS tunnel is in front | built-in TLS or a trusted-proxy setting |
| `read_only`, `token rotate` opt-outs not built yet | not needed by the foundation | before first release |
| Ephemeral `message.send` fields: the bridge forces `human: true`, `sender_label: "web"` | architecture 4.4 | never |
| Debug page UI is plain JS, not the TS data layer | the data layer is part 2; the debug page must work without it | the data layer exists (then the debug page may show its state) |

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
