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
  64 open Threads (= the bridge's watch bound; `openThread` throws `RangeError`), pages of 50 up to 1000 rows held,
  live preview 262144 UTF-16 code units, reconnect delay 1 s doubling to 10 s.
- **History is a window over the end of the path.** Observed on the real owner: `history.list`
  runs oldest to newest, `next_cursor` moves towards the newest, there is no way to start at the
  end, and any append expires cursors (`cursor_expired`). So the first read walks the path in
  pages of 100 with 4096-character excerpts, keeping the newest 400 items. Later reads ask only
  `since` the last known item and merge by node id. If that item is missing or its ordinal
  changed, the path was rewritten and the walk starts over. An expired cursor continues from the
  last item read; at most 8 such retries per read. `resync` starts over. `loadOlderHistory` doubles
  the window (limit 6400) and walks again. The cost of opening a Thread therefore grows with its
  history; a reverse read is on the list of needs from core.
- **Mutations** take an `operationId` (default `<instance_id>:<fresh UUID>`, the only form the owner
  accepts from a client; the instance comes from `hello`). A reply lost on socket close is
  `unconfirmed` and carries the id; the caller retries with the same id (idempotent through
  receipts) or looks it up with `operationGet`. The data layer never retries mutations itself.
  `human` and `sender_label` are set by the bridge, not by the data layer.

## Scale

User requirement (2026-11-07): many Threads must not mean all data in memory, and nothing may scale with the total number of Threads per render or per hint. What each thing holds:

| Item | Bound | Released |
|---|---|---|
| Thread list rows (`threadList`, sidebar, Monitor) | 1000 (`MAX_LIST_ROWS`), 50 per press of Show more; past it, search | Replaced by a changed search; a hint re-reads one page and keeps rows further down, which can stay stale until the next full read |
| `rows`, `rowById` | Derived once per list change, from those rows | With the list |
| Threads view | 5 pages of 200 (`ORG_MAX_PAGES`), re-read on a list change, one read at a time and one trailing; grouping is memoized | Mode or filter change |
| Branches view | One family, at most 256 Threads (owner's bound); 4 pages, 3 restarts | Thread change |
| Open Thread handles | 64 watched (`MAX_WATCHED_THREADS`); the Web UI holds 1, closed when another opens | On close |
| History window | 400 items of up to 4096 characters; up to 6400 if asked for | With the handle |
| Message bodies, step output | 64 entries each, oldest dropped; 8 pages of 64 KiB per entry at most | Oldest first; also on Thread change for output watch |
| Shell facts | 200 per Thread | Thread change |
| Branch marks | One map per open Thread; one family read per open | Thread change |
| Live preview | 262144 UTF-16 code units per open Thread | Discard rules below |
| Analytics walks | Days: at most 32 groups. By Thread: 2000 groups (`MAX_GROUPS`), then stops and says so; 64 windows per run | New period or Refresh |
| Compaction events | 50 rows for one Thread | New Thread or period |
| Resource reads | One value each | Replaced on Refresh |
| Markdown | No cache: a `useMemo` per mounted message, so bounded by the window | Unmount |
| Apps | 64 tabs and listeners; 20 errors per tab | On close; listeners with the bridge |
| Ticks | `now` each second, read by running steps; lists use `coarseNow`, every 30 s, so a tick doesn't re-render a list | — |

Long lists use `content-visibility:auto` rather than a JS virtual list, so off-screen rows cost layout only when reached. The DOM still holds them, up to the bounds above.

Measured (2026-11-07, one run, facts and not bounds): macOS arm64, headless Chrome, debug bridge, `shellboy` 0.10.0, temp owner seeded by SQL with 5,002 Threads and a 100,000-node Thread cloned from real rows, 1440x900.

| Scenario | First paint | Ready | JS heap after GC | DOM nodes | Long tasks | Frames while scrolling |
|---|---|---|---|---|---|---|
| Monitor, 50 rows | 44 ms | 73 ms | 1.7 MiB | 989 | 0 | 17 ms, p95 and max |
| Threads view, 200 rows | 44 ms | 79 ms | 2.2 MiB | 2,528 | 0 | 17 ms |
| By Thread (no usage in this seed) | 40 ms | 79 ms | 1.5 MiB | 450 | 0 | 17 ms |
| Monitor, 1000 rows (the bound) | | | 8.1 MiB | 17,518 | 0 | 17 ms |
| 100,000-node Thread | | 30.8 s, 1,002 `history.list` calls | 3.1 MiB | 2,205 | 0 | 17 ms over 140 messages |
| Four tabs on it at once | | 150 s each | about 3 MiB each | | | |

Five list hints with 1000 rows expanded: 5 `thread.list` calls, no long task, no rows lost. With 5,000 Threads, one page of the list costs what it costs with 50. These frames come from a scripted scroll in headless Chrome, which paints nothing to a screen, so they say the main thread kept up, not how it looks. The seed's Threads are idle: a real owner with many running Threads wasn't tried, nor was a phone, nor Safari or Firefox.

What needs core: the only remaining thing that scales with the data is opening a long Thread, which walks the whole path and takes 30 s for 100,000 nodes, though the page stays responsive and only 400 items are kept. That is Shellboy #268, and `long-threads.md` is the plan. By-Thread usage has the same shape in `usage.get` (`analytics-settings.md`), and needs a seek by date.

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
threadList(args) threadGet(id) historyList(args) historyGet(args) shellList(args) shellRead(args) operationGet(opId)
usageGet(args) compactList(args) storageStatus() indexStatus() memoryStatus() statusSummary() modelList(args)
threadCreate(args, opId?) messageSend({thread_id,text,deliver?}, opId?) runStop(runId, opId?) runRetry(runId, opId?)
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
| The first data-layer version assumed newest-first history pages; replaced by the window above (2026-11-07) | checking a real owner showed oldest-first pages, so a Thread over 50 nodes showed only its beginning | the owner offers a reverse read |
| Preview stays discarded after any discard until the owner wire defines an attempt boundary | cannot tell a resumed attempt from its middle | E3 wire exists |
