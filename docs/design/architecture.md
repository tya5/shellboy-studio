# shellboy-studio architecture

Status: design proposal, not implemented. Written 2026-11-06 against Shellboy
`origin/main` `740a50f7df` (v0.9.0, protocol 2) and the Shellboy study
`docs/design/events-and-external-protocol.md` (#243, #244), which is adopted in
principle but not yet implemented. Statements about Shellboy refer to that
revision; re-check them when the pinned Shellboy tag changes. The decisions of
2026-11-06 in §15 refine this document; where text and §15 differ, §15 wins
until the text is updated.

## 1. Goals and non-goals

User decisions (2026-11-06):

1. **UX better than the TUI** for reading and driving a conversation: rich
   Markdown and code rendering, collapsible tool output, live progress, Thread
   list, send and stop. Later: branch graph, search, compaction markers,
   attachments, several Threads side by side.
2. **Phone access**: responsive layout and installable PWA. Remote use goes
   through Tailscale or an SSH tunnel; the bridge binds to localhost by default,
   checks a token, and binds to a LAN address only when explicitly configured.
3. **Layered, swappable UI**: a heavily tested data layer is the UX boundary;
   presentation can be redesigned or replaced without touching it (§2.1).
4. **Non-server users**: a desktop app and a GUI first-run setup (§11, §12).

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
                         │ shellboy-studio (bridge)    │  one process, user's machine
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
| Bridge (`shellboy-studio` binary) | Rust | HTTP listener, auth cookie, WebSocket sessions, the single `events.wait` loop and its fan-out, an operation allowlist, bounded concurrency toward the owner, embedded static assets | agent logic, DB reads, rendering decisions, caching saved facts beyond one in-flight read, starting or stopping the owner |
| Data layer (`web/data`) | TypeScript, framework-agnostic | normalized state, operations, the view-model API (§2.1) | DOM, layout, talking to the owner directly, inventing facts not returned by an RPC |
| Presentation (`web/ui-*`) | TypeScript + a UI library | layout, visual design, Markdown/code rendering, offline shell (PWA) | state derivation, protocol knowledge |
| Debug page (`web/debug`) | TypeScript | raw inspection (§2.2) | being enabled by default |
| Shellboy owner | Rust (separate repo) | all saved facts and their ordering, receipts, cancellation, change hints | knowing that a browser exists |

### 2.1 Layers and the UX boundary

1. **Bridge (Rust)**: owner RPC, one multiplexed `events.wait` long-poll fanned
   out to all tabs, streaming, auth. No view logic.
2. **Data layer (TypeScript, framework-agnostic)**: builds normalized state
   from RPC results and events (Threads, Turns, nodes, tool runs, deliveries,
   in-progress streamed text) and exposes a **view-model API** (read-only
   signals) plus **operations**: send, stop, open Thread, rewind (including the
   one-key rewind/confirm/undo of Shellboy #246), create Thread, connection and
   folder setup (§12). This API is the UX boundary and is tested heavily
   (Vitest against recorded owner payloads and a real owner in integration).
   State is reactive: signals updated by WebSocket push; no page reload, no
   client polling. Transport sits behind an adapter interface (WebSocket now,
   Tauri IPC later, §11); the layer has no browser-only assumptions (URL
   routing, cookie auth live in the adapter or presentation).
3. **Presentation**: swappable. Several layouts/designs may coexist and be
   selected by setting or URL. Rebuilding it must not touch layers 1 and 2.
   Layout and visual design start only after the foundation works end to end;
   at that point stop and brainstorm the look with the user.

### 2.2 Debug page

A separate entry and bundle, shipped in production builds but enabled only by
an explicit debug startup option (off by default; the route is not registered
otherwise). Same token check as the app. It shows raw events, data-layer state,
RPC round trips with timings, and buttons for send, stop and create Thread.

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
  Long-polls share the owner's 24 ordinary slots; the bridge keeps ONE for all
  tabs (the study requires multiplexing), so it holds one permit permanently.
  There is no durable change log for now: after `resync` clients re-read saved
  facts, and conversation content is fully persisted as today.
- **Live text streaming (option A).** Shellboy core returns model text written
  since a cursor through the same long-poll (no persistence; core stage E, A
  part). The bridge forwards it as `live` frames (§3.2) and keeps no history
  of it; the saved result replaces it when the Turn settles. Option B (a
  streaming response) is considered only if A is not smooth enough.
- **Reads after a hint are issued by the data layer**, through the proxy (§3.2).
  The bridge does not decide which RPCs a view needs; that keeps view logic in
  one place (the data layer) and the bridge free of projection code.
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
| `hello` | bridge version, the owner's data directory, owner `{protocol_version, instance_id, capabilities}` or `unreachable` | first frame; frontend enables features by capability |
| `result` | `id`, owner `Response` or bridge error `{code, message}` | reply to `call` |
| `changed` | `thread_ids`, `list` | coalesced dirty set since the last `changed` frame |
| `live` | `thread_id`, `attempt_id`, `gap`, `deltas[{offset, reasoning, text}]` | unsaved model text this tab has not been sent; bounded, lossy with an explicit gap (the tab discards first). Capability `live.text` |
| `live_end` | `thread_id` | no text is held for the Thread any more; saved output follows |
| `resync` | — | re-read everything shown |
| `owner` | `connected` / `unreachable` / `restarted` | owner reachability |

Hints and live text are not queued per message (live text is one bounded copy shared by tabs, at most 16 attempts of 64 KiB, with a sent position per watched Thread per tab; a tab that falls behind the bound is told with `gap`). Each session holds a dirty set
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
`history.list`, `history.get`, `operation.get`. Reads added for Analytics and Settings: `usage.get`, `compact.list`,
`storage.status`, `index.status` (`analytics-settings.md`). Mutations: `thread.create`,
`message.send`, `run.stop`, `run.retry`, `thread.archive`, `message.cancel`, plus the
rewind operations of Shellboy #246 once available. `events.wait` is bridge-internal.
Everything else (`owner.shutdown`, deletion, prune, `storage.collect`, index and
compaction mutations) is rejected with a bridge error until a milestone adds a UI for it. The list
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

## 4. UI behaviour (M1)

Views below are data-layer view models; their layout belongs to presentation.

### 4.1 Views

- **Thread list**: from `thread.list`, re-read on a `changed` with `list`.
  Activity and state words come from the owner's fields, not recomputed.
- **Conversation**: `history.list` pages (cursor-based, newest page first) with
  Markdown rendering of model and user text, code blocks with highlighting and
  a copy button. Tool calls render as collapsible rows (collapsed by default
  once settled, expanded while running); body from `shell.get`/`shell.read`.
- **Live progress**: streamed model text (§3.1) while a Turn runs, then the saved output; Run/Turn state from `thread.get` → `run.get`/`turn.get`,
  tool start/finish from `shell.list`, re-read on each `changed` for the open
  Thread. Elapsed time ticks client-side from saved `started_at`; it is a
  display tick, not a data poll.
- **Composer**: send (`message.send`, `deliver` default) and stop (`run.stop`).
  Held/queued input shows the owner's delivery state from `message.get`.

### 4.2 Vocabulary (no text glyphs)

The Web UI does not use the TUI's text glyph marks. It expresses state with
richer, clearer means: colour, icons, shape and motion. It does keep Shellboy's
state *meanings and words* consistent (same names for the same states, from the
owner's fields); the glyph vocabulary is a TUI concern only.

### 4.3 Live shell output in M1

`events.wait` deliberately excludes shell output bytes (study §2.3). M1 shows
"running, last output at …" from `shell.get` and reads the output so far with
`shell.read` when a row is expanded and on change hints. Live tail of a running
shell is M2; the bridge will not poll `shell.read` on a timer.

### 4.4 Sender identity

The bridge sends `message.send` with `human: true` and `sender_label: "web"`.
Shellboy records `human` as an unverified client claim, which is accurate: the
person behind the authenticated browser session typed it.

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
5. The debug page (§2.2) is not routed unless the debug option is given.
6. The bridge never logs message text, tokens or cookies; logs contain
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
(`shellboy-studio token rotate` invalidates all sessions). Built-in TLS is not in
M1; a tunnel provides it.

## 6. Version skew with the owner

- The bridge links the Shellboy crate at a git tag; it speaks exactly that
  tag's `PROTOCOL_VERSION`. Shellboy's owner accepts exactly one version
  (current-only, protocol.md Issue #33).
- **Before protocol 3** (today): a mismatch is rejected in Hello/Welcome with
  `client_protocol_version`/`owner_protocol_version`. The bridge reports both
  plus the Shellboy release it was built against, in the `hello` frame and on
  stdout. Rule: use the shellboy-studio release built for your Shellboy release.
- **From protocol 3** (#244 stage A2): results are tolerant and `Welcome`
  carries `capabilities`. A bridge built against Shellboy X keeps working with a
  later owner that has the same protocol version; features added after X are
  simply unused. A bridge newer than the owner checks capabilities before
  sending a newer field or operation and hides the feature.
- Decided: the owner accepts one protocol version with handshake capabilities
  (protocol 3); no version range.
- The data layer never sees the protocol version directly; it reads
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

Types come from the git dependency on the `shellboy` crate; the frontend gets
them via JSON Schema (§7.2). Cost of the git dependency: building the bridge compiles Shellboy's full
dependency tree (Ratatui, bundled SQLite, sqlite-vec, reqwest, …) although the
bridge only uses `protocol` and `ipc`. Measure clean build time and binary
size once and record them; split a protocol crate in Shellboy only if the cost is large. The bridge must not copy protocol types to avoid it.

### 7.2 Frontend (TypeScript)

The data layer (§2.1) uses only `@preact/signals-core` (framework-agnostic
signals). The table below is the presentation stack of the first design; it is
replaceable.

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
| Text written since a cursor, returned through `events.wait` (option A; no persistence; bounded, lossy with explicit gap) | #243 core stage E, A part (to be filed) | M1 streaming |
| Streaming response (option B) | only if A is not smooth enough | nothing now |
| Rewind operations (one-key rewind/confirm/undo) | #246 | M1 rewind UI when available |
| Possibly a per-Thread digest in `changes` | stage E1, only if measurement shows follow-up reads dominate | nothing; optimisation |
| Possibly a shell-output hint or receipt-free output wait | not filed | M2 live shell tail |
| Connection config write, working-folder selection and related setup operations, model/provider validation, in-app update trigger | future core needs (§12) | first-run GUI |
| `serve` startup exposed as a library function; owner location accepting an in-process owner | future core needs (§11) | desktop app |

The bridge does not ask core for Web-specific behaviour; each item is a
general external-client surface also usable by `shellboy chat` and scripts.

## 9. Milestones

**M1 — conversation view with live streaming (desktop first, responsive).**
Thread list; conversation with Markdown/code rendering and collapsible tool
rows; live Run/Turn/tool state via hints; live model text streaming (option A);
send, stop, new Thread (and rewind when #246 is available); owner
unreachable/restart handling; token auth; localhost default; responsive layout
baseline; debug page. Depends on Shellboy #244 A1 (typed errors), #243 B
(`events.wait`), the streaming-text addition (core stage E, A part), and the
protocol 3 / schema items in §8. Visual design is deferred until the
foundation works end to end (§2.1). Done when the integration suite passes on
macOS, Linux and Windows CI and the acceptance record lists what was tested
where.

**M2 — phone polish and live shell tail.** Live shell output tail; PWA install,
offline shell page, touch-sized controls, safe-area layout; reconnect-on-resume
for mobile browsers; Tailscale/SSH setup guide verified on a real phone.

**M3 — beyond the TUI.** Branch graph (`thread.branches`), search
(`history.search`), compaction markers (`compact.list`), attachments
(`attachment.*`), several Threads side by side, usage view (`usage.get`).
Each adds its operations to the allowlist and its own tests.

## 10. Packaging and release

- Separate repository and release cadence. A shellboy-studio release states the
  Shellboy release (tag) it was built against and therefore the protocol
  version it speaks.
- Release binaries are the supported install. Node is required at build time;
  built assets are not committed.
- One binary `shellboy-studio` per OS/CPU, frontend embedded. Release assets and
  installer follow Shellboy's pattern (archives with SHA-256, `install.sh` /
  `install.ps1`, no sudo, `~/.local/bin`) so users install both the same way.
- Until the first binary release: `cargo install --locked --git
  https://github.com/tya5/shellboy-studio --tag <tag>` (documents the Node
  requirement; `build.rs` builds the frontend).
- Before protocol 3: users must pair releases exactly. From protocol 3: any
  owner with the same (single) protocol version works; new features appear when both
  sides support them.
- Tags, published releases and binaries need the user's explicit approval, as
  in Shellboy.

## 10.1 Release target: one binary, one command (user decision 2026-11-06)

M1 is developed with two separately started processes (owner via `shellboy serve`, then the bridge). The release target is a single `shellboy-studio` binary: connect to a running owner if one holds the data dir; otherwise start the owner in-process through Shellboy's headless `serve` exposed as a library function; act as the `shellboy` CLI when invoked with arguments (multicall) and put itself on model shells' PATH as `shellboy`; open the browser (setting to disable). This is the desktop form B (§11) without the Tauri window, so the core prerequisites are shared. Constraint: while shellboy-studio or `serve` owns the data dir, the TUI cannot run on it, because the TUI is itself an owner today; attaching the TUI to an existing owner is a future Shellboy feature (study issue).

## 11. Desktop app (future)

Order: Web UI, then PWA install (near-zero work), then Tauri when OS
integration is needed.

Preferred form B: ONE binary that runs the owner in-process (Shellboy core
exposes the headless `serve` startup as a library function) plus the bridge
library and the frontend. The same executable acts as the `shellboy` CLI when
invoked with arguments (multicall), and the owner puts it on the PATH of model
shells as `shellboy`, so the agent's shells call the CLI. One owner per data
dir stays: the TUI and CLI connect to the app's owner over IPC.

- Window close keeps the app running in the tray while work is live (decide
  later).
- A UI crash takes the owner down; owner recovery is interruption-safe.
- No version skew inside the app.
- Needs macOS signing/notarization, Windows signing and auto-update.
- Fallback form A: sidecar (app launches a separate owner process).

Design-now constraints: the bridge is a library crate plus a thin HTTP binary;
the data-layer transport is behind an adapter interface (WebSocket vs Tauri
IPC); no browser-only assumptions in the data layer; the bridge library accepts
the owner location (external IPC owner or in-process owner).

## 12. First-run experience (desktop and web)

For people who don't know servers: GUI connection setup (pick provider or
LiteLLM endpoint and model, enter the key; the key is stored in the OS
keychain), a folder picker for the working directory, a clear explanation that
the agent runs shell commands locally (convenient default plus a stricter
opt-in setting), and in-app updates. Connection and folder setup are
data-layer operations usable by both web and desktop. Future core needs: write
connection config, set the working folder, validate provider/model, keychain
access for the key, trigger an update (§8).

Connection setup for the Web is built: see `connection-setup.md` (Shellboy #269
operations; the key is stored by the owner in a plain owner-only file, not the OS
keychain, which #269 leaves out).

## 13. Risks

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
- **Streaming smoothness**: option A (long-poll text since cursor) may not be
  smooth enough; fall back to option B only after measuring.
- **Phone browsers** suspend background tabs and drop WebSockets; reconnect
  must resync, which is the same path as owner restart.

## 14. Open questions

None. The first design brainstorm with the user is the look of the UI, once
the foundation works end to end (§2.1).

## 15. Decisions recorded here

| Decision | Reason | Revisit when |
|---|---|---|
| Browser issues reads; bridge only proxies and fans out hints | no projection logic in the bridge; one place for view logic | measurement shows many tabs duplicate the same reads |
| Empty `thread_ids` filter on the single long-poll | Thread list needs all hints; simplest | owner load from hints for unwatched Threads is measured as significant |
| No polling stand-in before `events.wait` | avoids the cost #243 removes and receipt writes from `wait` | never for M1; a development-only stand-in may exist behind a dev flag |
| Preact + Vite + markdown-it; highlight.js deferred (`design-system.md`) | smallest familiar stack that covers M1–M2 | streaming or rendering measured too slow on phones |
| Token in URL fragment + HttpOnly cookie | not sent to servers/proxies; scripts on the page cannot read the cookie | a tunnel or browser breaks fragment handling |
| No text glyph marks in the Web UI; state words stay consistent (2026-11-06, user decision) | richer, clearer visual expression; meanings matter, not TUI glyphs | never without approval |
| Layers: bridge / data layer (UX boundary) / swappable presentation / debug page; layout deferred, brainstorm with user after end-to-end works (2026-11-06, user decision) | redesign without touching tested logic | the data-layer API proves wrong |
| Debug page: separate bundle, shipped, enabled only by explicit startup option (2026-11-06, user decision) | inspectability without default exposure | — |
| Streaming in M1 via option A (text since cursor in `events.wait`); option B only if not smooth (2026-11-06, user decision) | reuses the one long-poll; no persistence | measured smoothness |
| Shellboy side: long-polls share 24 slots, one bridge long-poll; no durable change log; one protocol version with capabilities (protocol 3); models may use `events.wait`; name `events.wait`; types via git dependency, frontend via JSON Schema (2026-11-06, user decision) | smallest owner surface | measured permit pressure |
| Port 8751; config/token in OS config dir; bridge connects to a running owner only (except the desktop app) (2026-11-06, user decision) | simple, predictable | — |
| M1 writes: `thread.create`, `message.send`, `run.stop`, `message.cancel` (+ #246 rewind); shell output read on expand/change, live tail M2 (2026-11-06, user decision) | scope | UI for deletion exists |
| Web sends recorded as human, `sender_label: "web"`; UI language follows Shellboy's (En/Ja) (2026-11-06, user decision) | accurate and consistent | — |
| Release binaries are the supported install; Node at build time; built assets not committed; measure the whole-crate dependency first, split a protocol crate only if large (2026-11-06, user decision) | simple release path | measured cost |
| Reactive state via signals with WebSocket push; responsive baseline in M1, PWA/phone polish in M2 verified on a real phone (2026-11-06, user decision) | no reload or polling | — |
| Desktop app future: Web, then PWA, then Tauri form B (single binary, in-process owner, multicall CLI); sidecar A fallback; design-now constraints in §11 (2026-11-06, user decision) | non-server users | OS integration needed |
| First-run GUI setup for connection, folder, security explanation, in-app updates; needs new core operations (§12) (2026-11-06, user decision) | non-server users | — |
| `usage.get`, `compact.list`, `storage.status` and `index.status` join the allowlist as reads for Analytics and Settings (2026-11-07) | saved facts only, no provider request and no receipt; every related mutation stays denied (`analytics-settings.md`) | a UI offers a mutation with a preview |
| `run.retry` and `thread.archive` join the allowlist with the data layer's operations (2026-11-07) | the data layer exposes them as typed operations (`docs/design/data-layer.md`); `thread.unarchive` stays denied until a UI offers it | a UI for unarchive exists |
| First-run connection setup screen behind capability `connection.setup`, Cargo feature `next-connection-setup`; `connection.test` is a read, `credentials.set` and `credentials.clear` are mutations (2026-11-07) | #269's operations are on a branch; one screen from nothing to a first message (`connection-setup.md`) | the operations are in a Shellboy release |

### Conversation work observation decision (2026-11-07)

| Decision | Reason and impact | Revisit when |
|---|---|---|
| Use one bounded Thread-scoped `status` page and at most eight bounded original previews; do not walk continuation pages or enumerate unbounded Run-owned IDs | The public RPC has no bounded equivalent of the TUI live-work/held-input snapshot. Counts are lower bounds when truncated; ordinary waits and owned child Runs can be missing. | Shellboy adopts a bounded, hint-invalidated external live-work and pending-input projection. |
| Leave the #262 reply-wait wire adapter inert | W6 capability and protocol are not yet finalized. The UI can exercise an injected adapter, but production shows no reply-wait rows. | W6 reports the adopted capability, bounded read and answer contract. |

### Studio guide and app request decision (2026-11-07)

| Decision | Reason and impact | Revisit when |
|---|---|---|
| Bundle guides in Studio and overwrite the installed agent guide at startup | The guide describes Studio rather than core; no user AGENTS.md is changed. A custom apps directory is shown by Studio, not inferred from the data directory. | The Apps host exposes an agent-readable discovery surface for custom directories. |
| Require a typed working folder and review of the exact request before creating a Thread | The browser cannot safely browse the host filesystem through the current RPC; typing gives explicit choice without adding bridge filesystem access. An uncertain create/send is not retried automatically. | Shellboy adopts a bounded, authorized folder-selection surface. |
