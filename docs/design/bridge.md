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

## Live text

With `next-shellboy` the one `events.wait` loop sends `include_text: true` from its first (baseline)
call. Nothing else polls. The result's `live_text` goes into `live::Store` inside the `Hub`; tabs are
woken only for Threads they watch whose text changed, and receive `live` / `live_end` frames with
only what they have not seen. Rules, from the core's client rule (events-and-external-protocol 2.5):

- `baseline` and `resync_required` forget what was held, then take the reply. `resync` frames
  clear each tab's sent positions and mark its held Threads for sending again.
- An attempt absent from `live_text` is no longer held: `live_end` to tabs that were sent it. A Thread
  past the owner's 16-attempt cap simply has no text; that is normal.
- A new `attempt_id` or `gap: true` replaces the attempt (the tab is told `gap` and discards first).
  A tab whose position fell behind what the bridge kept is told `gap` too.
- "Local IPC work capacity is busy" (`invalid_state`, details `phase: admission`,
  `request_may_have_been_applied: false`) is a routine retry with the same cursor after the poll
  backoff. It is not `unreachable` and drops nothing. Other errors stay `unreachable`, and drop the held text.
- Bounds: 16 attempts, 64 KiB per attempt counting 40 bytes per delta (the owner's own, oldest whole
  deltas dropped), shared by all tabs; per tab one position and one dirty mark per watched Thread (64
  at most). They are not a memory measurement.

## Seams

`src/seam.rs` is the only place that knows about work not on Shellboy main:

- Protocol 3 / `Welcome.capabilities` (#244 A2): `owner_capabilities()` returns an empty
  list now. `hello` and `owner` frames already carry `capabilities`.
- Live text (E3, Shellboy #243, on main, in no release): `events_args()` asks with `include_text`
  and `decode_events_result()` returns the attempts the owner lists as holding text, both only with
  the Cargo feature `next-shellboy`. A normal build never asks, never decodes it, and does not
  advertise the capability `live.text`.

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

`connection.test` (read), `credentials.set` and `credentials.clear` (mutations) are allowed only with the Cargo feature `next-connection-setup`, which advertises the capability `connection.setup`; a decode error of these calls never repeats the arguments (`connection-setup.md`).

`thread.tag` (mutation) and `thread.tags` (read) are allowed only with the Cargo feature `next-tags`, which advertises the capability `thread.tags`; `thread.cwds` (read) only with `next-cwds` (capability `thread.cwds`), whose variant is not in any Shellboy yet and which has not been compiled. `thread.list` filters `tags` and `cwd` pass through the existing `thread.list` arm (`branches-threads.md`).

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

## Live text validation record (2026-11-07)

Environment: macOS (Darwin 25.3, arm64), toolchain 1.99.1, debug builds, via rust-slot. The feature
build used a copy of the `shellboy` dependency patched in (`[patch]` to a source export of Shellboy
`a602ec6b27`, the main commit with E3 and without `history.window`; the patch was not committed). Main's
tip `8bdba5a27b` (adds `Command::HistoryWindow`) does not compile against the allowlist's exhaustive
match yet.

- Default build (pinned tag): clippy `-D warnings` clean; `cargo test` passes. No `live.text`, no
  `include_text`, no `live_text` decoding.
- `--features next-shellboy` against that copy: clippy clean; `cargo test` passes including a
  scripted owner (baseline mid-attempt, deltas, gap, timeout listing without deltas, absence as end,
  capacity-busy retry with the same cursor, owner loss dropping text) and a WebSocket test of
  `live` / `live_end` frames (one frame for 1000 deltas, only the watching tab, only unseen deltas).
- Real owner: `shellboy` built from `a602ec6b27`, `shellboy serve` with a temporary data dir and
  temporary HOME/XDG, a loopback streaming stand-in for the provider (no network, no key). A tab
  watching a Thread received `live` frames ("Hello ") while the provider was held back and nothing
  was in `history.list`; after release it received the rest and `live_end`, and `history.list` held the
  saved "Hello world" (`tests/real_owner.rs`, `live_text_reaches_a_watching_tab_and_the_saved_message_follows`).
- Not tested: a browser (the data layer and Conversation are tested with a fake owner and happy-dom,
  not Chrome), reasoning deltas from a real provider, a real provider, more than one attempt at once,
  the 16-attempt cap on a real owner, two tabs on a real owner, Windows, Linux, Markdown rendering cost
  of a very long live reply.
- `hints_and_restart_against_a_real_owner` failed in about 3 of 10 parallel runs with the live text
  poll: its `changed` hint can arrive before the reply of the call that caused it, and the test
  discarded frames while waiting for the reply. The test now takes both in either order (12 of 12
  passed after). No fault of the owner or bridge was found.
