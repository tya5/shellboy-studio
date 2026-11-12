# shellboy-studio architecture

Status: historical architecture baseline, partially implemented. Written 2026-11-06
against Shellboy `origin/main` `740a50f7df` (v0.9.0, protocol 2). The current
implementation and later design documents supersede forward-looking statements here;
see the README and `docs/first-release-verification.md` for current status and limits.
The decisions of 2026-11-06 in section 15 refine this document.

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
rewind operations of Shellboy #246 once available. `thread.set` is restricted to either parent changes or model/connection/effort changes for one Thread; model catalog reads are explicit and late responses are discarded. `events.wait` is bridge-internal.
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
- Current pairing: protocol 5 (#276), Core v0.12.0 with conversation schema 43. Version 4 peers fail closed;
  there is no downgrade, alias or payload rewrite. Handshake capabilities do not
  override an exact protocol-version mismatch. Before release, validate the exact
  published Core tag/lock/binary pairing separately.
- Run ownership and duplicate Thread-get reply lists are removed. Shell ownership
  and organizational Thread parents remain. The bounded `awaiting_replies` inbox
  distinguishes human and Thread duties through explicit recipient fields.
- The bridge and bundled frontend are released together. The frontend observes
  the bridge's connected-owner facts; the Core IPC handshake enforces the wire
  version before that owner is published as connected.
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
- The v0.1.0 candidate requires the exact validated protocol-5 Core release pair.
  No compatibility with protocol-4 or older owners is claimed.
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
| Use one bounded Thread-scoped `status` page and at most eight bounded original previews; do not walk continuation pages or enumerate unbounded Run-owned IDs | The public RPC has no bounded equivalent of the TUI live-work/held-input snapshot. Counts are lower bounds when truncated; ordinary waits can be missing; protocol 5 has no Run-owned child Runs. | Shellboy adopts a bounded, hint-invalidated external live-work and pending-input projection. |
| Leave the #262 reply-wait wire adapter inert | W6 capability and protocol are not yet finalized. The UI can exercise an injected adapter, but production shows no reply-wait rows. | W6 reports the adopted capability, bounded read and answer contract. |

### Studio guide and app request decision (2026-11-07)

| Decision | Reason and impact | Revisit when |
|---|---|---|
| Bundle guides in Studio and overwrite the installed agent guide at startup | The guide describes Studio rather than core; no user AGENTS.md is changed. A custom apps directory is shown by Studio, not inferred from the data directory. | The Apps host exposes an agent-readable discovery surface for custom directories. |
| Require a typed working folder and review of the exact request before creating a Thread | The browser cannot safely browse the host filesystem through the current RPC; typing gives explicit choice without adding bridge filesystem access. An uncertain create/send is not retried automatically. | Shellboy adopts a bounded, authorized folder-selection surface. |

### Settings editing decision (2026-11-08)

| Decision | Reason and impact | Revisit when |
|---|---|---|
| Configuration editing uses the owner's file hash and reports the owner's per-change application flags | Concurrent edits must be refused rather than overwritten; connection generations may apply without a restart while other changes do not. | The owner changes its config-edit contract. |
| Keep the Shellboy release pin unchanged while validating against a temporary origin/main pairing | The pinned tag does not include the new operations; a local patch is not a release pairing. | A suitable Shellboy tag is published and the pairing is approved. |

### Owner version information (2026-11-08)

| Decision | Reason and impact | Revisit when |
|---|---|---|
| Show the running owner software version as unavailable; propose a general version field on the external-client handshake or status RPC | The public owner contract reports a protocol version, not the running binary's software version. Neither the local executable nor startup logs reliably identifies the owner, and direct log access is outside the bridge boundary. | Shellboy adopts and releases a documented owner software-version surface. |

### Branch comparison reads

When `history.window` is advertised, visible branch rows may request two bounded windows (split and tip), sequentially; the row owns cancellation on exit. Old owners retain the existing branch view. Missing excerpts are not guessed.

### Explicit no-auth mode (Studio #4)

Only the explicit CLI `--no-auth` bypasses bridge token/session checks. It creates
no token file. Host allowlisting applies to all routes; same-authority Origin checks protect
authenticated HTTP endpoints and WebSocket requests, including the public one-bit `/auth-mode` bootstrap.
Absent Origin retains the existing non-browser-client behaviour; local processes
and permitted tailnet clients can therefore operate the bridge. No wildcard
Host/Origin, proxy-header trust, new owner RPC, queue or background task is added.
Auth exchange returns 204 without issuing a cookie in this mode; pairing endpoints
return 409 rather than creating unused credentials. Existing app capability URLs
and their sandbox checks remain independent and are not relaxed. Guide preference
reads/writes use the same guarded no-auth/session decision. The UI configuration
bit is no-store, contains no owner data and adds a persistent desktop/mobile badge.
Default token/session authentication and restart behaviour remain unchanged.

### Protocol 5 Human Inbox Bound

The existing Awaiting you surface uses the public human-only live keyset list,
not a full Thread scan. Its data-layer adapter owns one displayed page of 16
Threads, at most 128 duties per Thread, sequential detail reads, one existing
Refresher key (one running/one coalesced follow-up), and no timer/worker/queue.
The existing Show more control replaces the displayed page using its opaque
keyset cursor; hints restart from the first page because this is not a snapshot.
Expired cursors/errors are reported, not silently walked. Shutdown cancels the
current read and disposes its signal subscription. Replies use only displayed
human message IDs. In-flight duplicate submissions share one outcome; uncertain
retries retain the exact operation ID and text. Retained uncertain outcomes are
bounded by 16*128; reaching the bound refuses new replies rather than dropping
an uncertain identity. Thread-directed duties remain open-only in their existing
per-Thread surface. Count 17 with exact=false renders 17+, with no oldest age.
No next-reply/live feature is enabled. Revisit page size only with measured need.

### Branch Excerpt Admission

Branches compares saved excerpts only within two inspected positional windows,
not the first request or final conclusion across the full path. An observed
assistant response may be an intermediate protocol5 attempt. Missing or failed
reads remain unknown; window revisions must agree before facts are combined.
Only post-divergence responses qualify for child summaries.

The existing list displays batches of eight rows. One ExcerptBatch belongs to
the Branches model, admits each row once per batch epoch, and retains at most
eight entries; no poller, worker or unbounded queue is introduced. It drains
one excerpt reader at a time, with no retry: split at most25 nodes and tip at
most49 nodes, excerpt_chars256, at most two RPCs/row, sixteen RPCs/epoch and
592 projected node entries. Offscreen, stale owner/list, retarget, family
reread and leave cancel/invalidate facts; late results never publish. Exhausted
or revisited rows remain unknown until the next explicit batch/read epoch.

Family reads are separate: at most four pages of200 per attempt and three
cursor-expired restarts, hence sixteen RPCs per family invocation (stable valid
families of at most256 normally need two). A family invocation plus one excerpt
batch therefore issues at most32 RPCs, at most one family and one excerpt RPC
concurrently. Repeated notifications initiate new bounded epochs, not a global
lifetime budget. Existing WS4/global8 execution limits do not replace this
admission bound. Shutdown cancels both owned reads. Limits describe work, not
latency. No full-path scan or history-list fallback is used.

### Fork Chain Extension (ADR-F1)

One AppModel-owned fork chain adds at most two receipts to the existing rename,
archive and rewind slots: four slots/six receipts total. Immutable parent/node/
normalized text/original owner is reserved before dispatch; identical in-flight
calls join. Unknown outcomes retain identity and refuse changed payloads.
Only canonical fork acknowledgement fixes the child; send recovery never forks
again. Existing owner-generation/invocation guards apply before all new stages,
projection and refresh. Clear/read/leave preserve receipts but invalidate stale
projection as appropriate. Opaque diagnostic lookup cannot mark success.
No persistent reload recovery or real-owner exactly-once guarantee is asserted.
The existing B12 eight-row/serial-excerpt and bounded-family budgets do not change.

### Conversation Handoff (ADR-C1, Supported Final Projection)

One ledger per watched Thread retains at most eight attempt attachments and one
MiB of UTF-8 text total, including unpublished frame admission and bodies leased
to a held history window. The existing 262144 UTF-16 per-preview bound remains.
These are client payload bounds, not a JavaScript heap guarantee. On overflow keep
previously visible material, stop admitting new preview text (not the Core
stream), and mark it incomplete with a saved-history/retry notice. No disk spill,
poller, worker or persistent global body map is introduced. A paused view retains
its bounded ledger but invalidates reads; last-handle close/owner/session changes
invalidate it. One aggregate resolver is admitted; other watched entries have one
coalesced rerun bit each under the existing 64-Thread bound. At most eight RPC
starts occur per explicitly opened/resumed/retried reconciliation generation.
Hints consume that budget and cannot refill it. No status cursor walk is used;
absence from the first 200 work rows remains unknown.

A live_end/tool/new attempt is not proof of saving. Neither newest-node changes,
text similarity, time nor Turn end_message_node_id identify an intermediate
response. Complete #279 refs must identify the exact Thread/attempt/Turn and one
explicit message/final_answer without competing eligible messages. This permits
only the approved history.get end_message_only body projection, not arbitrary
item readback. Exact selected-path anchors before/after body read must match node,
ordinal and revision. Empty projected text, partial cursor, wrong identity,
ambiguous phase, missing refs, malformed refs or truncation do not prove a ready
answer. Read failures retain text and expose explicit retry. Commentary/multiple
message body disambiguation remains the unimplemented Core #290 contract gap.

An exact identity reservation suppresses only its ordinary message projection while
the retained body owns display; readiness and final transfer still require safe
body verification. Tools on
the same node remain independently projected; node-level suppression must not
remove steps. A stable logical key AND component parent/list keep the existing
Message DOM across replacement and subsequent generations. WindowedScroll's live
slot is always in its one keyed vspace list, including when its boundary is past
the held range. No scroll-intent algorithm, compensation or debounce is changed.

Window handoff receive is a non-reading, non-scrolling API validating immutable
scope/node/kind/ordinal/revision proof. A bucket owns the same immutable body
attachment that the ledger view lease references; quota counts it once and never
resets on transfer. Off-window/revision mismatch declines transfer, retaining the
ledger. Automatic eviction/revision reset returns the lease to the ledger;
actual close ends it. Maps detach before invoking callbacks, and only the exact
attachment/lifetime callback can release a lease. Explicit retry's read generation
is separate from the attachment's owner lifetime. Reentrant receivers cannot
reserve twice or install a result after owner teardown.

Changed hints reconcile the displayed attempt before refreshing history. If a
read failed, that history hint stays coalesced until retry/recovery so an incoming
raw row cannot race the failed visible body. Unrelated history is not hidden. An exact anchored node reserved by a retained
record is suppressed even while its body is unverified, preventing two copies. This delays history updates during a
failed handoff; it is an explicit candidate tradeoff for review, not a timer or a
claim that all unsupported mixed cases are solved. No-metadata tool first arrival
without a live record remains outside the supported final-answer subset.

The failed-handoff gate applies only to history for that Thread. Detail and active
work/status refresh immediately; lightweight hint observers and list consumers
are not gated. History is marked stale while held, with an explicit failed-row
notice; pause/navigation or owner/session reset clears the old gate. A regression
checks these independent consumers during a failed body lookup.

### Sender Identity And Current Titles (#285, ADR-A285)

Studio displays existing owner NodeProvenance.sender facts; it does not parse
model notification text or reconstruct identity from labels, origin_thread_id,
selected Thread, title or body. The data-layer guard accepts an object (not
null/array), explicit kind=model and a nonempty opaque string thread_id. The
unchanged full ID is identity and link destination. Missing/malformed model IDs
remain unknown-model, never human/You; absent/unsupported sender kinds are unknown.
Only explicit human provenance is You. A self-asserted label is separate text,
never automatically populated or treated as a verified name/title. Title/label
rendering is escaped text. No owner DTO, persisted field, wire or bridge change.

The Conversation's view-owned SenderTitles resolves current titles via existing
thread.get. Existing nonstale owner-list rows are preferred without a lookup.
Do not expand that shared cache; the resolver retains at most 16 distinct candidate
entries and performs at most 16 total RPC attempts per budget, one in flight.
Later IDs keep their full-ID fallback. A same-title pair stays distinct by ID;
renames may update from current valid cached rows without a new RPC. A cached
rename observed during an in-flight request wins over that older response.

Budget scope is owner observation generation + conversation route/selected Thread
+ explicit page selection. Closing/leaving discards resolver entries, candidate
membership and queued work, cancelling its sole flight; the flight slot is not
reused before its promise settles. Owner/route/page changes reject late replies.
Candidate removal cancels obsolete work but consumes its original candidate and
attempt allowance; hints, automatic history revisions, rendering and membership
churn do not refill or evict the lifetime candidate set. Errors/deleted IDs,
unsupported requests and response-ID mismatch remain ID fallback, not automatic
retry. Current-page selection is explicit earlier-page completion or the existing
jump-to-newest control. Automatic virtual-window movement does not refill.

Ownership/cancellation is reserved before invoking transport; reply adoption
rechecks that exact flight, lifetime, scope, current membership and requested ID.
An owner switch also bars stale old-owner history and list rows from starting
lookups in the new owner's scope. Existing transport handles request timeout and
cancellation. There is no persistent/global cache, new subscription, queue worker,
poller, body parsing, network adapter or new dependency. Monitor tiles display
recorded sender ID/label and unknown states without starting a second resolver.

### Tracked Assistant Publication (ADR-T8)

Initial committed unreferenced legacy history is a baseline, not proof of safe
item bodies. Existing history is not globally hidden. Within that watched view,
new assistant nodes are qualified before their first Message publication; explicit
older paging is not a fresh append. An already-known exact non-message ref also
gates an initial row. Positional history applies the same gate before returning
a read. Its initial ordinal watermark is a local safety boundary, not an
attempt/body identity: it survives an owner/capability ABA so a previously tracked
node cannot be laundered through the legacy first-read fallback. Proof caches are
cleared on that owner change. A genuinely new view starts a new baseline.

A client-only qualification accompanies the bounded history row. It is stripped
from incoming owner DTOs and never serialized in an RPC. Missing, failed,
truncated, cursor-incomplete, malformed, ambiguous, competing-attempt or unknown
phase refs remain unknown with explicit retry. Exact function_call refs expose
identity only (attempt and output ordinal); they do not create command, execution
ID, state, success or body spans. A mixed tool/message node does not expose its
aggregate as prose. The existing C1 safe final projection remains separate.

Ordinary excerpt publication requires one terminal exact Thread/attempt/Turn
association, a complete bounded status page, complete well-formed refs with no
competing attribution, and exactly one relevant final_answer message ref for the
node. Commentary/null/unknown phase and multi-message nodes stay unknown; no
JSON shape, text/time/order similarity or item-span inference is used. Plain
message JSON stays ordinary message JSON when that qualification is proved.

C1 owns the shared candidate and additional-lookup allowance: at most eight
combined live attachments/publication candidates and eight RPC starts per
explicit reconciliation generation; retained preview bodies keep their existing
one-MiB UTF-8 budget. Publication proofs have no retained body copy. Candidate
identity maps have an independent eight-entry hard bound even when multiple
nodes refer to a live attempt. One aggregate additional lookup is admitted across
C1 and publication qualification, with no per-client unbounded wait queue or
polling. Existing active-work reads remain their existing user-selected reader;
the gate does not launch another work subscription. Hints consume but never
refill the shared budget. On exhaustion new rows remain unknown in the bounded
history window while existing safe content remains. Explicit retry resets only
publication priority and the explicit read generation, not safe live text.

The legacy retained history and positional proof caches have their existing
window bounds; the latter holds at most eight proof entries, no global node map.
Each read captures generation/cancel/owner lifetime before any publication,
rechecks after status callbacks and rejects late owner/pause/cancel/close results.
Actual unresolved status calls occupy the shared slot until they settle. There
is no new queue, worker, persistent cache, wire/API or Core #290 implementation.
Arbitrary unreferenced legacy aggregate classification remains unsupported;
normal legacy display is not advertised as universally tool-safe.

### Exact identity reservation during C1 body readback

Once the existing bounded resolver has verified a unique exact Thread/attempt
final-answer reference and its assistant-response anchor, the retained record may
reserve that node identity before a safe final body is available. This reservation
is not readiness or a window transfer proof. Ordinary history must not paint a
second message for that exact node while the retained logical message owns display.
Partial pages, mismatched response nodes, unsupported bodies and failures keep the
retained text and confirming/retry (or failure) chrome; they never promote a body
by inference. All existing owner epoch/cancellation invalidation and eight-record,
UTF-8 one-MiB, eight-start read budget and single-resolver bounds remain unchanged.
No new read, queue, guessed span, or public protocol is introduced.
