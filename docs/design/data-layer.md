# Data layer (foundation, part 2)

Status: implemented (2026-11-07), local only. Code in `web/data/src`, tests in
`web/data/test`. Refines `architecture.md` §2.1; it contains no DOM, CSS, layout, markup or
glyphs and no browser-only types (`tsc` runs with `lib: ES2022` only). The WebSocket is the
only browser API, behind the `Transport` interface (`transport.ts`).

## Modules

| File | Role |
|---|---|
| `protocol.ts` | `/ws` envelope types, strict frame parser, owner record types (hand-written until Shellboy publishes JSON Schema, #244 D) |
| `transport.ts` | `Transport` interface; `WebSocketTransport` (reconnect with doubling delay 1 s to 10 s, injectable socket and timers) |
| `link.ts` | one shared connection: call ids, bounded call scheduler, `watch`, event fan-out, connection signals |
| `operations.ts` | typed operations (the request side of the UX boundary) |
| `refresher.ts` | per-target read coalescing |
| `store.ts` | `ShellboyData`: signals (view model), tracking handles, hint and resync handling |
| `live.ts` | live text preview rules and the E3 stub |
| `errors.ts` | `OpError` kinds and `Outcome<T>` |

## Rules

- **One shared subscription.** The store sends one `watch` frame (union of open Threads, list
  flag) after every change of the tracked set, coalesced per microtask, and again on every
  socket open (the bridge session starts empty).
- **Hints are not data.** `changed`, `resync` and `owner` only cause re-reads
  (`thread.list`, `thread.get`, `history.list`). Hints for Threads nobody opened are ignored.
  Nothing is optimistic: a mutation changes state only when its hint arrives and the Thread
  is re-read.
- **Coalescing.** Per target (`list`, `thread:ID`, `history:ID`) at most one read runs. Requests
  made before it is written to the socket merge into it; requests made while it is on the
  wire schedule exactly one trailing read (the running read may predate the change).
- **Resync.** `resync`, `owner: restarted`, and `hello` (every socket open, with the owner
  connected) re-read everything tracked. `restarted` followed by `resync` costs at most one
  trailing read per target. Socket close and `owner: unreachable` keep values, set `stale`,
  discard live previews; the next `hello`/`resync` re-reads.
- **Reads wait for the owner**: nothing is read until `hello` shows the owner connected.
- **Bounds** (limits, not performance claims): 4 calls on the wire (= the bridge's per-session
  running bound, so `busy` should not occur), 256 outstanding calls then local `busy`,
  64 open Threads (= the bridge's watch bound; `openThread` throws `RangeError`), pages of 50,
  live preview 262144 UTF-16 code units, reconnect delay 1 s doubling to 10 s.
- **History refresh replaces all loaded pages** with the newest page: cursors expire when the
  history changes, and without a known item key older pages cannot be merged without risking
  duplicates. A `loadOlderHistory` that finishes after a refresh is dropped.
- **Mutations** take an `operationId` (default a fresh UUID). A reply lost on socket close is
  `unconfirmed` and carries the id; the caller retries with the same id (idempotent through
  receipts) or looks it up with `operationGet`. The data layer never retries mutations itself.
  `human` and `sender_label` are set by the bridge, not by the data layer.

## Public API (short)

```ts
const data = new ShellboyData({ transport: new WebSocketTransport({ url: defaultBridgeUrl() }), newId? });
data.start(); data.stop();
// signals
data.connection  // 'connecting' | 'open' | 'closed'      data.failedAttempts
data.owner       // {state:'unknown'} | {state:'connected', info} | {state:'unreachable'}
data.capabilities, data.bridgeVersion, data.invalidFrames, data.bridgeError
data.threadList  // PagedState<ThreadSummary>              data.listFilter
data.trackThreadList(): Handle; data.setListFilter({query?, archived?}); data.loadMoreThreads(); data.refreshThreadList()
const h = data.openThread(id)   // ThreadHandle; h.detail, h.history, h.preview (signals)
h.refresh(); h.loadOlderHistory(); h.close()
// operations (data.operations), each returns Outcome<T> = {ok,value}|{ok:false,error:OpError}
threadList(args) threadGet(id) historyList(args) operationGet(opId)
messageSend({thread_id,text,deliver?}, opId?) runStop(runId, opId?) runRetry(runId, opId?)
threadArchive(ids, {descendants?}, opId?)
```

## Live text (E3): what is stubbed

The browser `stream` frame is handled: text since the last frame is appended per open Thread;
`gap: true`, resync, restart, unreachable, socket close and exceeding the bound discard the
preview (saved output is shown). The owner-wire rules (new `attempt_id`, Thread missing from
`live_text`, baseline, `resync_required`) need the E3 wire and are not detectable from the
browser frame; `discardPreview(reason)` already accepts those reasons and
`applyOwnerLiveText()` is a stub that throws `LiveTextWireUnknownError`.
After a discard the preview stays discarded: cursors are opaque, so a later frame cannot be told
apart from the middle of the same attempt. Needed to resume and to drop the preview when the
Turn settles: an attempt boundary from the owner (see the hand-off report).

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| Vitest 5.0.4, TypeScript 6.0.3, `@preact/signals-core` 1.14.4 (exact, all older than two weeks on 2026-11-07) | design names Vitest; TS 7 (native) not adopted yet | a new TS major is stable |
| `package.json` lives in `web/`, covering `web/data` now and the app and debug bundles later | one lockfile, one toolchain | the app bundle is added |
| Debug page stays plain JS and is not connected to the data layer | it has no build step; connecting it needs the bundle | the app bundle and Vite exist |
| `run.retry` and `thread.archive` added to the bridge allowlist | requested data-layer operations | — |
| Preview stays discarded after any discard until the owner wire defines an attempt boundary | cannot tell a resumed attempt from its middle | E3 wire exists |
