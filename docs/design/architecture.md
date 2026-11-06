# shellboy-web architecture

Status: design proposal, not implemented. Written 2026-11-06 against Shellboy
`origin/main` `740a50f7df` (v0.9.0, protocol 2) and the Shellboy study
`docs/design/events-and-external-protocol.md` (#243, #244), which is adopted in
principle but not yet implemented. Statements about Shellboy refer to that
revision; re-check them when the pinned Shellboy tag changes.

## 1. Goals and non-goals

User decisions (2026-11-06):

1. **UX better than the TUI** for reading and driving a conversation: rich
   Markdown and code rendering, collapsible tool output, live progress, Thread
   list, send and stop. Later: branch graph, search, compaction markers,
   attachments, several Threads side by side.
2. **Phone access**: responsive layout and installable PWA. Remote use goes
   through Tailscale or an SSH tunnel; the bridge binds to localhost by default,
   checks a token, and binds to a LAN address only when explicitly configured.

Non-goals:

- No agent logic, model calls, prompt building, tool execution or context
  policy. Shellboy's owner is the only place those exist.
- No direct access to Shellboy's SQLite database, `app_meta`, logs or files in
  the data directory other than `endpoint.json` (through Shellboy's own client
  code).
- No agent-protocol integrations (ACP, A2A, AG-UI, product-specific adapters).
  The browser speaks only this project's small WebSocket envelope.
- No multi-user accounts. One bridge serves one OS user's owner.
- No hosted service. The bridge runs on the machine that runs the owner.

## 2. Components

```
 browser tab(s) ──HTTPS/WS (tunnel)──┐
 phone (PWA)    ──────────────────────┤
                                      ▼
                         ┌─────────────────────────┐
                         │ shellboy-web (bridge)    │  one process, user's machine
                         │  HTTP: static assets     │
                         │  WS:   envelope + proxy  │
                         │  1 events.wait long-poll │
                         └───────────┬─────────────┘
                                     │ local IPC (Unix socket / named pipe),
                                     │ one request per connection, protocol N
                                     ▼
                         ┌─────────────────────────┐
                         │ Shellboy owner           │  `shellboy` TUI or `shellboy serve`
                         └─────────────────────────┘
```

| Component | Language | Owns | Never does |
|---|---|---|---|
| Bridge (`shellboy-web` binary) | Rust | HTTP listener, auth cookie, WebSocket sessions, the single `events.wait` loop and its fan-out, an operation allowlist, bounded concurrency toward the owner, embedded static assets | agent logic, DB reads, rendering decisions, caching saved facts beyond one in-flight read, starting or stopping the owner |
| Frontend (`web/`) | TypeScript | view state, Markdown/code rendering, layout, offline shell (PWA), per-tab subscriptions | talking to the owner directly, inventing facts not returned by an RPC |
| Shellboy owner | Rust (separate repo) | all saved facts and their ordering, receipts, cancellation, change hints | knowing that a browser exists |

The bridge is a thin client in the same sense as `shellboy chat`
(`src/chat_client.rs`): it calls the public RPC through `shellboy::ipc::call`
with typed `shellboy::protocol::Command` values and no Origin (sender kind
`external_cli`, or `human` with `human: true`, see §4.4).

## 3. Data flow

### 3.1 Bridge ↔ owner

- Transport is Shellboy's existing one: discover the endpoint from
  `<data-dir>/endpoint.json`, Hello/Welcome, exactly one request and one
  response per connection, 8 MiB frame limit. The bridge uses
  `shellboy::ipc::call`, so discovery, peer-uid checks (Unix) and version
  checks are Shellboy's code, not a reimplementation.
- **One long-poll for all tabs.** The bridge runs exactly one
  `events.wait{after, thread_ids: [], timeout_ms: 30000}` loop with an empty
  filter (all Threads), because the Thread list needs hints for every Thread
  anyway. It keeps the opaque cursor in memory only. Results:
  - `baseline`: remember cursor; tabs read current state on connect anyway.
  - `changed`: for each `thread_id`, mark it dirty for every WebSocket session
    whose subscription includes it (or that shows the Thread list); continue
    with `cursor` immediately (also when `more = true`).
  - `timeout`: continue.
  - `resync_required` (owner restart or cursor below floor): send `resync` to
    every session; tabs re-read everything they show.
  - transport error / owner unreachable: tell sessions `owner: unreachable`,
    retry with capped exponential backoff, restart from `after: None`, then
    send `resync`.
  This holds one of the owner's 24 ordinary IPC permits permanently, as the
  study requires ("a bridge must multiplex one long-poll for all browser tabs").
- **Reads after a hint are issued by the browser**, through the proxy (§3.2).
  The bridge does not decide which RPCs a view needs; that keeps view logic in
  one place (the frontend) and the bridge free of projection code.
- **Concurrency bound toward the owner:** one global semaphore for proxied
  calls (initial bound 8, plus the long-poll) and a per-session in-flight bound
  (initial bound 4). Both are limits, not performance claims; revisit after
  measuring with several tabs. When a session is at its bound, further calls
  wait in that session's bounded queue (initial 32); beyond that the bridge
  replies `busy` and the tab retries on user action. No unbounded queue.

Until #243 stage B lands, there is no `events.wait`. The bridge must not
emulate it with a polling loop of `thread.list`/`wait` calls (that is the cost
#243 removes, and `wait` writes receipts and `app_meta` rows). M1 therefore
depends on #243 stage B (§8).

### 3.2 Bridge ↔ browser

One WebSocket per tab at `/ws`, JSON text frames, a small bridge-defined
envelope. Owner payloads pass through unchanged.

Browser → bridge:

| `t` | Fields | Meaning |
|---|---|---|
| `call` | `id` (tab-local integer), `command`, `args`, optional `operation_id` | proxy one owner RPC. The bridge decodes `{command, args}` into `shellboy::protocol::Command` (strict, rejects unknown fields before the owner sees them), checks the allowlist, calls the owner, returns the owner `Response` verbatim |
| `watch` | `thread_ids` (≤ 64), `list: bool` | replace this tab's subscription |
| `cancel` | `id` | drop the pending call; closing the IPC connection cancels a read on the owner side (`Invocation.disconnected`); for mutations the result may still apply (see below) |

Bridge → browser:

| `t` | Fields | Meaning |
|---|---|---|
| `hello` | bridge version, owner `{protocol_version, instance_id, capabilities}` or `unreachable` | first frame; frontend enables features by capability |
| `result` | `id`, owner `Response` or bridge error `{code, message}` | reply to `call` |
| `changed` | `thread_ids`, `list` | coalesced dirty set since the last `changed` frame |
| `resync` | — | re-read everything shown |
| `owner` | `connected` / `unreachable` / `restarted` | owner reachability |

Hints are not queued per message. Each session holds a dirty set
(≤ subscribed Threads + a list flag) and one pending-flush flag; a slow tab
gets one larger `changed` frame, never a growing backlog. This mirrors the
owner's own coalescing and needs no extra buffer.

**Mutations and lost replies.** The frontend generates `operation_id` (UUID v4)
for every mutation and reuses it on retry. Shellboy's receipts make a retried
`message.send` with the same ID idempotent; after a WebSocket drop the tab
shows "result unconfirmed" and offers `operation.get`, exactly like the CLI's
"uncertain mutation" guidance. The bridge never retries mutations by itself.

**Allowlist (M1).** Reads: `status`, `model.list`, `thread.list`, `thread.get`,
`run.get`, `turn.get`, `message.get`, `shell.list`, `shell.get`, `shell.read`,
`history.list`, `history.get`, `operation.get`. Mutations: `thread.create`,
`message.send`, `run.stop`, `message.cancel`. `events.wait` is bridge-internal.
Everything else (`owner.shutdown`, deletion, prune, storage, index, compaction)
is rejected with a bridge error until a milestone adds a UI for it. The list
is the set of operations the UI implements, so the browser cannot be used as a
generic remote shell into the RPC; it is one exhaustive `match` in the bridge,
not a registry.

### 3.3 HTTP routes

| Route | Purpose |
|---|---|
| `GET /` and asset paths | embedded frontend (immutable hashed asset names, `index.html` no-cache) |
| `GET /manifest.webmanifest`, `/sw.js` | PWA |
| `POST /auth` | exchange the token for a session cookie (§5) |
| `GET /ws` | WebSocket upgrade (cookie + Origin + Host checks) |
| `GET /healthz` | unauthenticated `ok` only, no owner data |

## 4. Frontend behaviour (M1)

### 4.1 Views

- **Thread list**: from `thread.list`, re-read on a `changed` with `list`.
  Activity and state words come from the owner's fields, not recomputed.
- **Conversation**: `history.list` pages (cursor-based, newest page first) with
  Markdown rendering of model and user text, code blocks with highlighting and
  a copy button. Tool calls render as collapsible rows (collapsed by default
  once settled, expanded while running); body from `shell.get`/`shell.read`.
- **Live progress**: Run/Turn state from `thread.get` → `run.get`/`turn.get`,
  tool start/finish from `shell.list`, re-read on each `changed` for the open
  Thread. Elapsed time ticks client-side from saved `started_at`; it is a
  display tick, not a data poll.
- **Composer**: send (`message.send`, `deliver` default) and stop (`run.stop`).
  Held/queued input shows the owner's delivery state from `message.get`.

### 4.2 Vocabulary and glyphs

The Web UI reuses Shellboy's decided state words and marks (`◉ ⁂ $ ↳ ⋯ ├─ └─`)
with the same meanings as in the TUI wherever it shows the same concept; check
the Shellboy User Guide and TUI code at the pinned tag for each meaning. It does not introduce new glyphs for concepts
the TUI already names; a new mark needs the user's approval, as in Shellboy.
Richer presentation (colour, typography, collapsing) is the Web's advantage;
different words for the same state are not.

### 4.3 Live shell output in M1

`events.wait` deliberately excludes shell output bytes (study §2.3). M1 shows
"running, last output at …" from `shell.get` and reads the output so far with
`shell.read` when a row is expanded and on each Thread hint. Continuous tail of
a running shell without a hint is deferred to M2 (open question Q4); the bridge
will not poll `shell.read` on a timer.

### 4.4 Sender identity

The bridge sends `message.send` with `human: true` and `sender_label: "web"`.
Shellboy records `human` as an unverified client claim, which is accurate: the
person behind the authenticated browser session typed it. (Open question Q5.)

## 5. Security model

Threat model: the bridge exposes control of a coding agent that can run shell
commands as the user. Anyone who can drive the bridge can run commands. The
defaults must be safe on a shared machine and in a browser that visits other
sites, while staying one command to use.

Defaults (convenient):

1. **Bind `127.0.0.1:<port>`** (fixed default port, configurable). IPv6
   loopback optionally. No LAN listener unless `--listen <addr>` or the config
   names a non-loopback address; then the bridge prints a warning that traffic
   is plain HTTP unless a TLS-terminating tunnel is in front.
2. **Token.** On first start the bridge creates a 256-bit random token in its
   own config directory (file mode 0600 on Unix; per-user directory on
   Windows) and prints `http://127.0.0.1:<port>/#token=<token>`. The token is in
   the fragment so it is not sent in requests or logged by proxies. The page
   posts it once to `/auth`, receives an `HttpOnly; SameSite=Strict` session
   cookie (`Secure` when served over HTTPS), and removes the fragment. A token
   is required even on loopback: other local users and DNS-rebinding pages can
   reach loopback ports.
3. **Origin and Host checks** on `/auth` and `/ws`: `Host` must be a loopback
   name, the configured listen address, or an explicitly configured external
   name (e.g. the Tailscale MagicDNS name); `Origin` must match `Host`. This
   blocks cross-site WebSocket hijacking and DNS rebinding.
4. **Operation allowlist** (§3.2) limits the surface to what the UI offers.
5. The bridge never logs message text, tokens or cookies; logs contain
   operation names, durations and error codes only.

Remote and phone access (recommended path):

- **Tailscale**: `tailscale serve` in front of the loopback port gives HTTPS
  with a valid certificate inside the tailnet; add the MagicDNS name to the
  bridge's allowed hosts. HTTPS is also what makes the PWA installable and the
  service worker work on a phone (secure context).
- **SSH tunnel**: `ssh -L <port>:127.0.0.1:<port> host`; the phone or laptop
  then opens its own `http://127.0.0.1:<port>`, which is a secure context.
- **LAN binding**: only by explicit configuration; documented as plain HTTP,
  token still required, PWA not installable without TLS.

Stricter opt-outs (off by default, settings, not prompts): `read_only = true`
(allowlist reduced to reads), shorter cookie lifetime, rotating the token
(`shellboy-web token rotate` invalidates all sessions). Built-in TLS is not in
M1; a tunnel provides it.

## 6. Version skew with the owner

- The bridge links the Shellboy crate at a git tag; it speaks exactly that
  tag's `PROTOCOL_VERSION`. Shellboy's owner accepts exactly one version
  (current-only, protocol.md Issue #33).
- **Before protocol 3** (today): a mismatch is rejected in Hello/Welcome with
  `client_protocol_version`/`owner_protocol_version`. The bridge reports both
  plus the Shellboy release it was built against, in the `hello` frame and on
  stdout. Rule: use the shellboy-web release built for your Shellboy release.
- **From protocol 3** (#244 stage A2): results are tolerant and `Welcome`
  carries `capabilities`. A bridge built against Shellboy X keeps working with a
  later owner that has the same protocol version; features added after X are
  simply unused. A bridge newer than the owner checks capabilities before
  sending a newer field or operation and hides the feature.
- The frontend never sees the protocol version directly; it reads
  `capabilities` from `hello`. Bridge and frontend ship in one binary, so they
  never skew with each other.
- Owner restart: Hello gives a new `instance_id`, `events.wait` reports
  `resync_required`; the bridge sends `owner: restarted` + `resync`.

## 7. Stack (recommendation)

Principle: few, mature dependencies, exact versions pinned, each recorded with
reason, bound and validation (same rule as Shellboy's AGENTS.md).

### 7.1 Bridge (Rust)

| Choice | Reason |
|---|---|
| Rust toolchain and edition pinned to the same versions as the pinned Shellboy tag (`rust-toolchain.toml`) | the Shellboy crate must build; one toolchain to reason about |
| `shellboy` (git dependency, exact tag) | typed `Command`/`Response`, `ipc::call` endpoint discovery and handshake; no protocol duplication (user decision) |
| `tokio` (same version as Shellboy) | already in the dependency tree; one runtime |
| `axum` (with `ws` feature) | thin layer over `hyper`/`tower`, WebSocket support built in, widely used, maintained by the Tokio project; avoids hand-rolling HTTP upgrade and header handling on raw `hyper` |
| `serde`, `serde_json`, `uuid` (versions unified with Shellboy) | already in the tree |
| `clap` (same as Shellboy) | CLI flags (`--listen`, `--data-dir`, `token rotate`) |
| static assets embedded by a `build.rs` that generates an `include_bytes!` table from `web/dist` | no extra crate; one binary; hashed names give cache safety |
| No TLS crate, no templating, no database, no tracing stack in M1 | not needed; tunnels terminate TLS; `eprintln!` style structured lines suffice until a need is shown |

Cost of the git dependency: building the bridge compiles Shellboy's full
dependency tree (Ratatui, bundled SQLite, sqlite-vec, reqwest, …) although the
bridge only uses `protocol` and `ipc`. Measure clean build time and binary
size once and record them; if the cost matters, propose a small protocol crate
in Shellboy (study Q5). The bridge must not copy protocol types to avoid it.

### 7.2 Frontend (TypeScript)

| Choice | Reason | Rejected |
|---|---|---|
| **Preact** (+ `@preact/signals`) | ≈4 KB runtime, React's component model (familiar to most contributors and to coding agents), JSX compiled by TypeScript/esbuild with no extra language; signals give fine-grained updates needed for M2 token streaming without re-rendering the whole transcript | React (larger, no benefit at this size); Svelte/Solid (good, but own compiler/language or smaller ecosystem; less familiar); vanilla DOM (state handling for list + transcript + streaming becomes the framework we would write) |
| **Vite** | dev server with proxy to the bridge, production build with hashed assets, TS out of the box; one tool | webpack (heavier); plain esbuild (no dev server/HMR, would need scripts) |
| **npm** with committed `package-lock.json`, exact versions, `npm ci` | no extra package manager to install | pnpm/yarn (another tool) |
| **TypeScript strict** (`tsc --noEmit`) | type gate in CI | — |
| **markdown-it** with `html: false` | mature CommonMark + GFM tables; raw HTML disabled, so model output cannot inject markup and no sanitizer dependency is needed; link rendering limited to `http(s)`/`mailto` | marked (needs DOMPurify for safety); remark/unified (many packages) |
| **highlight.js** (core + a fixed set of languages, others loaded on demand) | synchronous, no WASM, small per language | Shiki (best fidelity, but large grammar/WASM payload; revisit if quality matters more than size on phones) |
| `json-schema-to-typescript` (dev only) | generates `web/src/protocol.gen.ts` from Shellboy's committed `docs/reference/protocol.schema.json` at the pinned tag; a check fails if the generated file drifts | hand-written owner types |
| **Vitest** | unit tests for rendering, envelope handling, reducers; Vite-native | Jest (separate transform setup) |
| **Playwright** (Chromium, WebKit, Firefox; mobile viewport emulation) | end-to-end against a real bridge + real owner | — |

Formatting/linting: TypeScript strict plus `prettier` only; no ESLint plugin
tree in M1.

### 7.3 Tests

- Bridge unit tests: envelope decode, allowlist, auth (token, cookie, Origin,
  Host), session dirty-set coalescing, bounds and `busy` replies.
- Integration: start the pinned Shellboy release's owner (`shellboy serve`)
  with a temporary data directory and a local mock provider endpoint, run the
  bridge against it, drive with Playwright. No real API calls, no user data.
  A hand-written mock owner is avoided: it would duplicate the protocol and
  drift.
- Record environment, command and result separately; browser emulation of a
  phone viewport is not a phone test. Real-device checks (iOS Safari, Android
  Chrome) are recorded only when actually performed.

## 8. What the bridge needs from Shellboy core

| Need | Shellboy issue / stage | Blocks |
|---|---|---|
| Typed reply instead of connection close for unknown command/field | #244 stage A1 | correct "owner does not support X" errors (M1) |
| `events.wait` long-poll with resumable cursor, `resync_required` | #243 stage B | M1 (no polling fallback) |
| Tolerant result records, tolerant `Welcome`/`Endpoint`, `Welcome.capabilities`, protocol 3 | #244 stage A2 | M1 release (bridge must survive owner field additions) |
| `shellboy protocol schema` + committed `protocol.schema.json` + drift test | #244 stage D | frontend type generation (M1) |
| Typed results for operations still returning `json!`/`Value` (`thread.get`, `history.*`, `shell.*`, …), ordered by what the Web reads | follow-ups to #244 D, one issue per family | type quality; M1 can start with opaque fields |
| Live model text deltas over RPC (bounded, lossy with explicit gap, falls back to saved output) and a persistent multi-frame stream | #243 stage E2/E3 (future, needs its own decision) | M2 streaming |
| Possibly a per-Thread digest in `changes` | stage E1, only if measurement shows follow-up reads dominate | nothing; optimisation |
| Possibly a shell-output hint or receipt-free output wait | not filed (Q4) | M2 live shell tail |

The bridge does not ask core for Web-specific behaviour; each item is a
general external-client surface also usable by `shellboy chat` and scripts.

## 9. Milestones

**M1 — conversation view (desktop first, phone usable).** Thread list;
conversation with Markdown/code rendering and collapsible tool rows; live
Run/Turn/tool state via hints; send and stop; new Thread; owner
unreachable/restart handling; token auth; localhost default; responsive
layout. Requires #243 B and #244 A1, A2, D. Done when the integration suite
passes on macOS, Linux and Windows CI and the acceptance record lists what
was tested where.

**M2 — streaming and phone polish.** Token streaming of model text (requires
core stage E2/E3); live shell output tail (Q4); PWA install, offline shell
page, touch-sized controls, safe-area layout; reconnect-on-resume for mobile
browsers; Tailscale/SSH setup guide verified on at least one real phone.

**M3 — beyond the TUI.** Branch graph (`thread.branches`), search
(`history.search`), compaction markers (`compact.list`), attachments
(`attachment.*`), several Threads side by side, usage view (`usage.get`).
Each adds its operations to the allowlist and its own tests.

## 10. Packaging and release

- Separate repository and release cadence. A shellboy-web release states the
  Shellboy release (tag) it was built against and therefore the protocol
  version it speaks.
- One binary `shellboy-web` per OS/CPU, frontend embedded. Release assets and
  installer follow Shellboy's pattern (archives with SHA-256, `install.sh` /
  `install.ps1`, no sudo, `~/.local/bin`) so users install both the same way.
- Until the first binary release: `cargo install --locked --git
  https://github.com/tya5/shellboy-web --tag <tag>` (requires the frontend
  build output to be committed or built by `build.rs`; decide with the first
  release, see Q7).
- Before protocol 3: users must pair releases exactly. From protocol 3: any
  owner with the same protocol version works; new features appear when both
  sides support them.
- Tags, published releases and binaries need the user's explicit approval, as
  in Shellboy.

## 11. Risks

- **Core prerequisites slip** (#243 B, #244 A2/D): M1 cannot ship. Mitigation:
  build the bridge skeleton, auth and frontend rendering against a pinned
  development revision; no polling stand-in.
- **Hint completeness**: a Shellboy producer that forgets `changed()` leaves a
  stale Web view (the TUI's 500 ms tick masks it today). Mitigation: Shellboy's
  per-mutation-family test (#243 B); the Web offers a manual refresh and
  reports reproducible staleness as a core bug.
- **Permit pressure**: the long-poll holds one ordinary permit; proxied reads
  share the remaining 23 with `chat`, `wait` and model CLI calls. Mitigation:
  bridge-side global bound; measure.
- **Remote exposure**: misconfigured LAN binding or tunnel exposes a command
  runner. Mitigation: loopback default, mandatory token, Host/Origin checks,
  explicit warning, read-only opt-out.
- **Heavy git dependency**: long builds and a large binary for a thin client.
  Mitigation: measure, then propose a protocol crate split in Shellboy.
- **`Value` fields**: generated types are only as precise as the Rust types;
  opaque fields need careful frontend handling until typed.
- **No token streaming in M1**: the Web looks less live than the TUI during
  long model replies; the Turn state and elapsed time remain visible.
- **Phone browsers** suspend background tabs and drop WebSockets; reconnect
  must resync, which is the same path as owner restart.

## 12. Open questions for the user

1. **Port and config location**: a fixed default loopback port (any unused
   number; proposal 8751) and config/token
   in the OS config directory (`~/.config/shellboy-web/` etc.), separate from
   Shellboy's data directory — acceptable?
2. **Owner lifecycle**: should the bridge only connect to a running owner
   (proposal), or offer to start `shellboy serve` when none is running?
3. **Allowlist**: is the M1 mutation set (`thread.create`, `message.send`,
   `run.stop`, `message.cancel`) right? Deletion and `owner.shutdown` stay out
   until there is UI and confirmation for them.
4. **Live shell output**: is "output so far on expand and on hint" enough for
   M1, with continuous tail in M2 via a new core hint (unfiled), or is live
   tail an M1 requirement?
5. **Sender**: record Web messages as `human: true, sender_label: "web"`?
6. **Language**: these documents follow Shellboy's current policy (English by
   default). Should the Web UI's own labels be English, Japanese, or follow the
   Shellboy UI language once that is decided?
7. **Frontend build in `cargo install`**: commit built assets for tagged
   releases, or require Node in `build.rs`? (Proposal: release binaries are the
   supported path; `cargo install` documents the Node requirement.)
8. **Protocol crate split** in Shellboy if the git-dependency cost measured in
   M1 is large — wanted, or keep the single crate?
9. **Shellboy study Q2** affects this project directly: should the owner accept
   a small protocol range so a bridge can lag one Shellboy release?

## 13. Decisions recorded here

| Decision | Reason | Revisit when |
|---|---|---|
| Browser issues reads; bridge only proxies and fans out hints | no projection logic in the bridge; one place for view logic | measurement shows many tabs duplicate the same reads |
| Empty `thread_ids` filter on the single long-poll | Thread list needs all hints; simplest | owner load from hints for unwatched Threads is measured as significant |
| No polling stand-in before `events.wait` | avoids the cost #243 removes and receipt writes from `wait` | never for M1; a development-only stand-in may exist behind a dev flag |
| Preact + Vite + markdown-it + highlight.js | smallest familiar stack that covers M1–M2 | streaming or rendering measured too slow on phones |
| Token in URL fragment + HttpOnly cookie | not sent to servers/proxies; scripts on the page cannot read the cookie | a tunnel or browser breaks fragment handling |
