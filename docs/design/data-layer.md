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
| `live.ts` | `LiveText`: one Thread's live text preview (attempt, offsets, incomplete, ending), published once per scheduled tick |
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
  live preview 262144 UTF-16 code units (the newest text is kept past it), reconnect delay 1 s doubling to 10 s.
- **History is a window over the end of the path.** Observed on the real owner: `history.list`
  runs oldest to newest, `next_cursor` moves towards the newest, there is no way to start at the
  end, and any append expires cursors (`cursor_expired`). So the first read walks the path in
  pages of 100 with 4096-character excerpts, keeping the newest 400 items. Later reads ask only
  `since` the last known item and merge by node id. If that item is missing or its ordinal
  changed, the path was rewritten and the walk starts over. An expired cursor continues from the
  last item read; at most 8 such retries per read. `resync` starts over. `loadOlderHistory` doubles
  the window (limit 6400) and walks again. The cost of opening a Thread therefore grows with its
  history; a reverse read is on the list of needs from core.
- **With `history.window`** (capability, Shellboy #268, `next-shellboy`) the walk above is not used: the store only counts hints (`ThreadHandle.historyTick`) and `readWindow` sends positional reads for the long-thread reader, which owns what is held (`long-threads.md`). `history` stays unloaded on that path.
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
| Live preview | 262144 UTF-16 code units per open Thread (newest kept, marked incomplete) | Discard rules in Live text |
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

## Cancelling what nobody needs

User requirement (2026-11-07): requests made unnecessary are cancelled. `Cancel` (`operations.ts`) goes with a read. A call still queued in the Link is dropped and never sent; a call on the wire gets a `cancel` frame. At the bridge that aborts the task, whether waiting on a semaphore or running, which closes its owner connection. A cancelled read resolves with kind `cancelled`, which no screen shows as an error, and nothing is left marked as loading.

| Event | What stops |
|---|---|
| Another Thread opens | Its reads, its walk, step lists, output, full bodies, branch marks |
| The Conversation is left | The same, and its Thread leaves the bridge's watch, so no hints and no re-reads arrive. What's held stays. On return, a read asks only for what's new, and a first walk that didn't finish starts over |
| A step's row closes | Its output read |
| A search changes | The list read for the old one; a read for the new one always follows |
| An Analytics section is left | Walks not shown pause: their call is cancelled, what's read stays, and they carry on from the same cursor when shown again. Compaction and resource reads are cancelled, and read again on return |
| Stop or a new period | The walk's call |
| Branches or Threads is left, or their Thread, filter or mode changes | The read in progress, including later pages |
| An app's tab closes or reloads | Its calls, including long polls |
| The socket closes | Everything |

Mutations are never cancelled.

**What can't be stopped at the owner, read from the v0.10.0 source and not measured.** Every cancel closes the owner connection, and what that does depends on the command (`runtime_cancellable`, `protocol/command.rs`):

- Stops being waited for: `status --memory`, `model.list`, `history.search`, `shell.get`, `shell.read`, `events.wait`, `storage.status`, `index.preview` and index work. The owner drops the future at once. `history.search` also interrupts SQLite (`index/search/reader.rs`). For the others, cleanup is the reader's own, and whether a blocking step already running ends early wasn't checked.
- Runs to its end, and the reply is discarded: `thread.list`, `thread.get`, `thread.branches`, `history.list`, `history.get`, `history.relations`, `usage.get`, `compact.list`, `shell.list`, `index.status`, and the other commands the same match lists as false. Each also holds one of the owner's 24 work slots until it finishes (`MAX_IPC_WORK`, and the test `disconnected_accepted_work_keeps_all_slots_until_consumer_completion`).

Seen once in Chrome on the 5,002-Thread, 100,000-node temp seed, with 400 ms of emulated latency so reads were still in flight: leaving a long Thread 50 ms after opening it sent 3 `cancel` frames, and nothing more in the next 3 seconds. Four keystrokes in one go sent one `thread.list`. `usage.get` and `thread.branches` answered within about 11 ms there, before the view was left, so a cancel of those on a real owner, and a multi-page walk stopping, are covered only by unit tests.

So a cancelled walk costs at most the one page in progress, and later pages never start. Mutations are outside this: they aren't cancelled by design.

Core would need, for the second group: a check of the caller's token (`Invocation.disconnected`, which already exists) before a queued read starts, and an `interrupt` or SQLite progress handler tied to it for one already running, as search has. Positional reads (#268) make the pages small enough that this matters less.

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

## Live text (E3)

Behind the capability `live.text` (`ui-core/src/livetext.ts`), which the bridge advertises only
when built with the Cargo feature `next-shellboy` (`bridge.md`). Without it no `live` frame ever
arrives and the Conversation shows saved messages only, as on v0.10.0.

Frames: `live {thread_id, attempt_id, gap, deltas:[{offset, reasoning, text}]}` carries only what
this tab has not been sent; `live_end {thread_id}` says no text is held for the Thread. They follow
the client rule of `events-and-external-protocol` 2.5 (Shellboy):

- A new `attempt_id` or `gap: true` discards the preview, then deltas are appended. After a gap the
  preview is marked `incomplete`, and the Conversation says the text is not saved and a part was
  missed.
- Offsets count Unicode scalar values of the attempt, reasoning included. Reasoning text advances
  the offset and is not shown. A delta already held is skipped, one that overlaps is trimmed, and
  one that starts past what is held (or a preview that starts partway, as after a resync or for a tab
  that opens mid-attempt) marks the preview `incomplete`. Nothing is patched over.
- `live_end` keeps the text on screen (`ending`) until the saved message is there: the newest
  `assistant_response` of the loaded history differs from what it was when the attempt began. The
  core drops its text before the message is committed, so discarding at once would blank the answer
  and then show it. If the end arrives after the message was read, the text goes at once. If no
  message comes (Stop, a failure), the first `changed` read after the end drops the text (`ended`).
  The `live_end` itself also asks for one read of the Thread.
- Resync, `owner: restarted` or `unreachable` and socket close discard the preview. The bridge sends
  what it holds again after a `resync` (`bridge.md`), as the baseline rule says.
- Applying a frame updates the preview state at once; the signal is published once per `schedule`
  tick (`DataOptions.schedule`; the app passes `requestAnimationFrame`, tests a manual queue), so a
  burst of frames is one render. The Conversation does not read the preview: `LiveMessage` does, so
  text re-renders only that message (a smoke test counts Conversation renders).
- The preview shows the message as Markdown while it is written, like a saved one. Cost of that for
  a very long reply was not measured.

## Decisions

| Decision | Reason | Revisit when |
|---|---|---|
| Vitest 5.0.4, TypeScript 6.0.3, `@preact/signals-core` 1.14.4 (exact, all older than two weeks on 2026-11-07) | design names Vitest; TS 7 (native) not adopted yet | a new TS major is stable |
| `package.json` lives in `web/`, covering `web/data` now and the app and debug bundles later | one lockfile, one toolchain | the app bundle is added |
| Debug page stays plain JS and is not connected to the data layer | it has no build step; connecting it needs the bundle | the app bundle and Vite exist |
| `run.retry` and `thread.archive` added to the bridge allowlist | requested data-layer operations | — |
| The first data-layer version assumed newest-first history pages; replaced by the window above (2026-11-07) | checking a real owner showed oldest-first pages, so a Thread over 50 nodes showed only its beginning | the owner offers a reverse read |
| The `stream` frame (cursor, text) is replaced by `live` / `live_end` (2026-11-07) | the owner's wire is known now: attempts, offsets, gaps and reasoning need to reach the tab | — |
| Live text is kept past the bound by dropping the oldest, marked incomplete (was: discard the whole preview) | with attempt boundaries a long answer can stay visible and honest | measured use shows otherwise |

## Conversation work observations

The visible conversation opts its Thread handle into one `status` page per hint,
with a 200-item limit, filtered to active shell and undelivered message states.
A continuation is not walked: the displayed counts are lower bounds. `status`
contains other work kinds too, so a page can omit matching rows even when the
visible count is zero. It is not an atomic TUI live-work snapshot. The handle
owns the page and at most eight pending-message previews, each one `history.get`
of at most 1024 bytes. Original bodies are immutable; the cache is replaced on
refresh and discarded with the handle. Work subscriptions are reference-counted;
closing or pausing the handle cancels its reads. The existing Link scheduler
bounds concurrent and outstanding calls. Ticks never issue reads.

The public status page does not expose ordinary `wait` operations. `run.get`
exposes owned IDs but does not specify a paginated or bounded owned-ID list;
therefore this view does not enumerate children through it. The bounded shell
page can omit the command for an active execution; in that case its ID is shown.
A source original that cannot be read is shown as unavailable, not invented.
These limitations must be revisited when a bounded external live-work projection
and its invalidation semantics are adopted in Shellboy; this project does not
add one to core. Pending cancellation uses a single receipt-backed `message.cancel`
and checks its per-ID outcome. An unconfirmed result is shown as an error and is
not automatically retried.

The reply-wait adapter is deliberately inert until #262 W6 publishes its wire and
capability. Its eventual implementation owns bounded observations, subscriptions,
cancellation and cleanup; no capability or wire shape is guessed here. The
conversation projection caps the adapter's visible results at 128 and separates
human recipients from Thread recipients. The existing global Awaiting you adapter
remains independent and human-only.

### Stable monitor order

The Monitor projects only the already bounded Thread list. It retains the order
in which IDs first enter this local projection, appending newly observed IDs in
ID order; it forgets IDs removed from the list. Activity, state and hints update
row content and counts without moving retained rows. List replacement, filtering
or the owner's bounded retention can remove rows; the displayed counts therefore
cover loaded rows only. No additional RPC or polling is introduced. The per-browser
sort preference offers stable order (default) or descending `updated_at` with ID
as the tie-breaker. The stable order lives only for the AppModel's lifetime and
is rebuilt from the bounded current list after reload.

### Compacted tool output linkage

The public history projection does not expose a reliable association between a
spill node and its original execution. Until the owner provides that association
(and a way to read the original when available), Studio retains the existing row
and describes it as compacted output rather than guessing which tool it belongs to.
### Conversation status timing

The existing bounded `thread.get` and work projections expose running shell
`started_at`, but do not expose when the current model request began. The
conversation must not derive that time from `updated_at` or pretend an observed
client-side transition is the owner's start time. Model-wait duration is unknown
until an adopted public owner projection provides the corresponding timestamp.
