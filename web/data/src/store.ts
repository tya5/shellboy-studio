import { Handoff, type HandoffRecord } from "./handoff";
// The view-model: signals holding saved facts re-read through the proxy, never invented.
// Hints (`changed`, `resync`, `owner`) are triggers only; their payloads carry no data.
import { batch, computed, signal, type ReadonlySignal } from "@preact/signals-core";
import type { OpError, Outcome } from "./errors";
import { Link, type ConnectionState, type LinkEvent } from "./link";
import { microtaskSchedule, type Preview, type PreviewDiscardReason, type Schedule } from "./live";
import { Cancel, Operations } from "./operations";
import type {
  ArchivedFilter,
  HistoryItem,
  HistoryWindowArgs,
  HistoryWindowResult,
  OwnerState,
  ThreadDetails,
  ThreadSummary,
  WorkItem,
  Page,
} from "./protocol";
import { Refresher } from "./refresher";
import type { Transport } from "./transport";

/** Threads watched at once. Equals the bridge's per-tab bound; beyond it `openThread` throws. */
export const MAX_WATCHED_THREADS = 64;
/** Default page size for list reads (the owner's own maximum applies). */
export const PAGE_LIMIT = 50;
/** Thread list rows held, however many exist; past this, a search finds the rest. */
export const MAX_LIST_ROWS = 1000;
/** Page size of history reads. With HISTORY_EXCERPT_CHARS it keeps a page far below the 8 MiB frame. */
export const HISTORY_PAGE_LIMIT = 100;
/** Excerpt asked of `history.list`: the owner's maximum, so most messages need no `history.get`. */
export const HISTORY_EXCERPT_CHARS = 4096;
/** Newest history items kept per open Thread; `loadOlderHistory` doubles it up to the maximum. */
export const HISTORY_WINDOW = 400;
export const HISTORY_WINDOW_MAX = 6400;
/** The owner reads `history.window` (Shellboy #268). With it, history is read by position and never walked. */
export const CAPABILITY_HISTORY_WINDOW = "history.window";
/** `cursor_expired` continuations, and restarts after the path changed, within one history read. */
const HISTORY_READ_RETRIES = 8;

export interface Resource<T> {
  value: T | undefined;
  loading: boolean;
  /** Last read failed or the link/owner dropped since the value was read. */
  stale: boolean;
  error: OpError | undefined;
}

export interface PagedState<T> {
  items: T[];
  nextCursor: string | undefined;
  /** At least one successful read happened. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  stale: boolean;
  error: OpError | undefined;
}

/** The newest part of a Thread's selected path, ascending. */
export interface HistoryState {
  items: HistoryItem[];
  /** Items older than `items[0]` exist and were dropped by the window. */
  earlierHidden: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  stale: boolean;
  error: OpError | undefined;
}

export interface ListFilter {
  query?: string;
  archived?: ArchivedFilter;
}

export type OwnerView = { state: "unknown" } | OwnerState;

export interface Handle {
  close(): void;
}

export interface ThreadHandle extends Handle {
  readonly threadId: string;
  readonly detail: ReadonlySignal<Resource<ThreadDetails>>;
  readonly work: ReadonlySignal<Resource<Page<WorkItem>>>;
  setWorkActive(active: boolean): void;
  /** Oldest to newest, as the owner returns it; a window over the end of the path. */
  readonly history: ReadonlySignal<HistoryState>;
  readonly preview: ReadonlySignal<Preview>;
  readonly handoff: ReadonlySignal<readonly HandoffRecord[]>;
  readonly handoffOverflow: ReadonlySignal<boolean>;
  retryHandoff(): Promise<void>;
  retryPublication(): Promise<void>;
  handoffScope(): string;
  transferHandoff(attemptId: string, accept: (record: HandoffRecord, release: (reason: "return" | "end") => void) => boolean): boolean;
  /** Counts hints for this Thread's history while the owner has `history.window`; the window reader follows it. */
  readonly historyTick: ReadonlySignal<number>;
  /** One positional read. Nothing is sent for a closed or paused Thread. */
  readWindow(args: Omit<HistoryWindowArgs, "thread_id">, cancel: Cancel): Promise<Outcome<HistoryWindowResult>>;
  /** Cancels this Thread's reads (what leaving the view does). */
  cancelReads(): void;
  refresh(): Promise<void>;
  loadOlderHistory(): Promise<void>;
  /** False when the window reached its maximum. */
  canShowEarlier(): boolean;
  /** Stops reads and hints for this Thread, keeping what it has. */
  pause(): void;
  resume(): void;
}

export interface DataOptions {
  transport: Transport;
  /** UUID v4 source for operation ids. Defaults to `crypto.randomUUID`. */
  newId?: () => string;
  /** When live text is shown: called once per burst of frames. The app passes an animation frame. */
  schedule?: Schedule;
}

const emptyPaged = <T>(): PagedState<T> => ({
  items: [],
  nextCursor: undefined,
  loaded: false,
  loading: false,
  loadingMore: false,
  stale: false,
  error: undefined,
});

class ThreadEntry {
  refs = 0;
  closed = false;
  detail = signal<Resource<ThreadDetails>>({ value: undefined, loading: false, stale: false, error: undefined });
  work = signal<Resource<Page<WorkItem>>>({ value: undefined, loading: false, stale: false, error: undefined });
  workRefs = 0;
  workBodies = new Map<string, string>();
  history = signal<HistoryState>({ items: [], earlierHidden: false, loaded: false, loading: false, loadingMore: false, stale: false, error: undefined });
  window = HISTORY_WINDOW;
  /** The next read starts from the beginning of the path, not from the last known item. */
  fullRead = true;
  /** Unsaved model text; its signal is the handle's `preview`. */
  live: Handoff;
  resolving: Promise<void> | undefined;
  resolveAgain = false;
  refreshAfterHandoff = false;
  historyTick = signal(0);
  /** Bumped by every history read; a read started earlier drops its result. */
  historyGen = 0;
  publicationTail: number | undefined;
  publicationWindow = new Map<string, HistoryItem["assistant_publication"]>();
  /** Cancels this Thread's reads: dropped if queued, a `cancel` frame if sent. Replaced on resume. */
  cancel = new Cancel();
  /** Nobody is looking: no reads, and no hints from the bridge. */
  paused = false;
  constructor(readonly id: string, schedule: Schedule) {
    this.live = new Handoff(schedule);
  }
  get preview(): ReadonlySignal<Preview> {
    return this.live.preview;
  }
}

/** Keeps the first seen of each Thread, in order, within the bound. */
function mergeRows(first: readonly ThreadSummary[], then: readonly ThreadSummary[]): ThreadSummary[] {
  const seen = new Set<string>();
  const out: ThreadSummary[] = [];
  for (const row of [...first, ...then]) {
    if (seen.has(row.thread_id) || out.length >= MAX_LIST_ROWS) continue;
    seen.add(row.thread_id);
    out.push(row);
  }
  return out;
}

export class ShellboyData {
  readonly link: Link;
  readonly operations: Operations;

  private readonly ownerSig = signal<OwnerView>({ state: "unknown" });
  private readonly bridgeVersionSig = signal<string | undefined>(undefined);
  private readonly listenSig = signal<string | undefined>(undefined);
  private readonly appsDirSig = signal<string | undefined>(undefined);
  private readonly dataDirSig = signal<string | undefined>(undefined);
  private readonly invalidSig = signal<{ count: number; last: string | undefined }>({ count: 0, last: undefined });
  private readonly bridgeErrorSig = signal<{ code: string; message: string } | undefined>(undefined);
  private readonly listSig = signal<PagedState<ThreadSummary>>(emptyPaged());
  private readonly filterSig = signal<ListFilter>({});
  private listRefs = 0;
  private listGen = 0;
  private entries = new Map<string, ThreadEntry>();
  private publicationRead = false;
  private handoffRead: { entry: ThreadEntry; done: Promise<void> } | undefined;
  private watchQueued = false;
  private hintWatchers = new Map<string, Set<() => void>>();
  private readonly schedule: Schedule;
  private readonly refresher: Refresher;

  readonly connection: ReadonlySignal<ConnectionState>;
  readonly failedAttempts: ReadonlySignal<number>;
  readonly owner: ReadonlySignal<OwnerView>;
  /** Features the owner advertises (empty until protocol 3). Enable features from this. */
  readonly capabilities: ReadonlySignal<string[]>;
  readonly bridgeVersion: ReadonlySignal<string | undefined>;
  /** Which owner this bridge talks to. Only after sign-in. */
  readonly dataDir: ReadonlySignal<string | undefined>;
  readonly listen: ReadonlySignal<string | undefined>;
  readonly appsDir: ReadonlySignal<string | undefined>;
  /** Undecodable frames seen (count and last reason); a bug indicator, not a user message. */
  readonly invalidFrames: ReadonlySignal<{ count: number; last: string | undefined }>;
  /** Last `error` frame from the bridge (e.g. an invalid watch). */
  readonly bridgeError: ReadonlySignal<{ code: string; message: string } | undefined>;
  readonly threadList: ReadonlySignal<PagedState<ThreadSummary>>;
  readonly listFilter: ReadonlySignal<ListFilter>;

  constructor(options: DataOptions) {
    this.link = new Link(options.transport);
    this.schedule = options.schedule ?? microtaskSchedule;
    const newId = options.newId ?? defaultNewId;
    this.operations = new Operations(this.link, () => withInstance(this.ownerSig.peek(), newId()));
    this.refresher = new Refresher((key, onSent) => this.read(key, onSent));
    this.connection = this.link.connection;
    this.failedAttempts = this.link.failedAttempts;
    this.owner = this.ownerSig;
    this.capabilities = computed(() => {
      const o = this.ownerSig.value;
      return o.state === "connected" ? o.info.capabilities : [];
    });
    this.bridgeVersion = this.bridgeVersionSig;
    this.dataDir = this.dataDirSig;
    this.listen = this.listenSig;
    this.appsDir = this.appsDirSig;
    this.invalidFrames = this.invalidSig;
    this.bridgeError = this.bridgeErrorSig;
    this.threadList = this.listSig;
    this.listFilter = this.filterSig;
    this.link.subscribe((e) => this.onEvent(e));
  }

  start(): void {
    this.link.start();
  }
  stop(): void {
    this.link.stop();
  }

  /** Lightweight hint subscription: no detail or history reads. The caller owns and closes it. */
  watchHints(id: string, notify: () => void): Handle {
    if (!this.hintWatchers.has(id) && new Set([...this.entries.keys(), ...this.hintWatchers.keys()]).size >= MAX_WATCHED_THREADS)
      throw new RangeError(`at most ${MAX_WATCHED_THREADS} Threads can be watched`);
    let listeners = this.hintWatchers.get(id);
    if (!listeners) this.hintWatchers.set(id, listeners = new Set());
    listeners.add(notify);
    this.scheduleWatch();
    let closed = false;
    return { close: () => {
      if (closed) return;
      closed = true;
      listeners!.delete(notify);
      if (!listeners!.size) this.hintWatchers.delete(id);
      this.scheduleWatch();
    } };
  }

  private notifyHints(): void {
    for (const listeners of this.hintWatchers.values()) for (const notify of listeners) notify();
  }

  // ---- tracking ----

  /** Show the Thread list: re-read on list hints until the handle is closed. */
  trackThreadList(): Handle {
    this.listRefs++;
    if (this.listRefs === 1) {
      this.scheduleWatch();
      if (this.canRead()) void this.refresher.request("list");
      else this.listSig.value = { ...this.listSig.value, stale: this.listSig.value.loaded };
    }
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        if (--this.listRefs === 0) this.scheduleWatch();
      },
    };
  }

  /** A read for the old filter is no use: it's cancelled, and one for the new filter follows. */
  setListFilter(filter: ListFilter): void {
    this.filterSig.value = { ...filter };
    this.listCancel?.cancel();
    if (this.listRefs > 0 && this.canRead()) void this.refresher.requestFresh("list");
  }

  refreshThreadList(): Promise<void> {
    return this.refresher.request("list");
  }

  /** Whether "show more" can do anything: more exist, and the bound isn't reached. */
  canLoadMoreThreads(): boolean {
    const cur = this.listSig.value;
    return cur.nextCursor !== undefined && cur.items.length < MAX_LIST_ROWS;
  }

  async loadMoreThreads(): Promise<void> {
    const cur = this.listSig.value;
    if (!cur.nextCursor || cur.loadingMore || cur.loading || cur.items.length >= MAX_LIST_ROWS) return;
    const gen = this.listGen;
    const filter = this.filterSig.value;
    this.listSig.value = { ...cur, loadingMore: true };
    const out = await this.operations.threadList({ ...listArgs(filter), cursor: cur.nextCursor });
    if (gen !== this.listGen) return; // a refresh replaced the pages meanwhile
    const now = this.listSig.value;
    this.listSig.value = out.ok
      ? { ...now, items: mergeRows(now.items, out.value.items), nextCursor: out.value.next_cursor, loadingMore: false, error: undefined }
      : { ...now, loadingMore: false, error: out.error };
  }

  /** Track one Thread (detail, history, live preview). Throws past MAX_WATCHED_THREADS. */
  openThread(threadId: string): ThreadHandle {
    let entry = this.entries.get(threadId);
    if (!entry) {
      if (!this.hintWatchers.has(threadId) && new Set([...this.entries.keys(), ...this.hintWatchers.keys()]).size >= MAX_WATCHED_THREADS)
        throw new RangeError(`at most ${MAX_WATCHED_THREADS} Threads can be open at once`);
      entry = new ThreadEntry(threadId, this.schedule);
      this.entries.set(threadId, entry);
      this.scheduleWatch();
      if (this.canRead()) this.requestThread(threadId);
      else batch(() => {
        entry!.detail.value = { ...entry!.detail.value, stale: true };
      });
    }
    entry.refs++;
    const e = entry;
    let closed = false;
    let watchingWork = false;
    const setWorkActive = (active: boolean) => {
      if (closed || watchingWork === active) return;
      watchingWork = active;
      e.workRefs += active ? 1 : -1;
      if (active && e.workRefs === 1 && !e.paused && this.canRead()) void this.refresher.request(`work:${threadId}`);
    };
    return {
      threadId,
      detail: e.detail,
      work: e.work,
      setWorkActive,
      history: e.history,
      preview: e.preview,
      handoff: e.live.records,
      handoffOverflow: e.live.overflow,
      retryPublication: () => {
        if (closed || e.closed || e.paused) return Promise.resolve();
        if (e.cancel.cancelled) e.cancel = new Cancel();
        e.live.resetPublicationPriority();
        e.live.reconcile();
        return this.refresher.request(`history:${e.id}`);
      },
      handoffScope: () => this.handoffScope(e),
      transferHandoff: (id, accept) => { if (closed || e.closed || e.paused) return false; return e.live.transfer(id, accept); },
      retryHandoff: () => { if (closed || e.closed || e.paused) return Promise.resolve(); if (e.cancel.cancelled) e.cancel = new Cancel(); if (e.resolving) { e.live.reconcile(); e.resolveAgain = true; return e.resolving; } e.live.reconcile(); return this.resolveHandoff(e); },
      historyTick: e.historyTick,
      readWindow: async (args, cancel) => {
        if (e.closed || e.paused) return Promise.resolve({ ok: false, error: { kind: "cancelled", message: "thread is not being read" } });
        const epoch = e.live.epoch;
        const valid = () => !closed && !e.closed && !e.paused && !cancel.cancelled && epoch === e.live.epoch && this.canRead();
        const out = await this.operations.historyWindow({ thread_id: threadId, ...args }, { cancel });
        if (!out.ok || !valid()) return out.ok ? { ok: false, error: { kind: "cancelled", message: "publication owner changed" } } : out;
        if (out.value.thread_id !== threadId) return { ok: false, error: { kind: "cancelled", message: "window Thread mismatch" } };
        const baseline = e.publicationTail;
        const next: HistoryItem[] = out.value.items.map(rawItem => {
          const { assistant_publication: _untrusted, ...item } = rawItem;
          const ordinal = item.selection?.ordinal;
          const held = item.node_id ? e.publicationWindow.get(item.node_id) : undefined;
          const knownTool = e.work.peek().value?.items.some(attempt => attempt.thread_id === e.id && attempt.response_nodes_truncated === false && Array.isArray(attempt.response_nodes) && attempt.response_nodes.some(ref => ref?.node_id === item.node_id && ref.kind === "function_call"));
          return item.kind === "assistant_response" && item.node_id && (held || knownTool || baseline !== undefined && ordinal !== undefined && ordinal > baseline)
            ? { ...item, assistant_publication: held ?? { state: "unknown" as const } } : item;
        });
        await this.qualifyPublication(e, next, cancel, valid);
        if (!valid()) return { ok: false, error: { kind: "cancelled", message: "publication owner changed" } };
        if (baseline === undefined) e.publicationTail = Math.max(-1, out.value.total - 1);
        e.publicationWindow = new Map(next.filter(item => item.node_id && item.assistant_publication).slice(0, 8).map(item => [item.node_id!, item.assistant_publication]));
        return { ok: true, value: { ...out.value, items: next } };
      },
      cancelReads: () => { e.live.invalidate(); e.cancel.cancel(); },
      refresh: () => this.requestThread(threadId),
      loadOlderHistory: () => this.loadOlder(e),
      canShowEarlier: () => e.window < HISTORY_WINDOW_MAX,
      pause: () => this.pauseEntry(e),
      resume: () => this.resumeEntry(e),
      close: () => {
        if (closed) return;
        setWorkActive(false);
        closed = true;
        if (--e.refs === 0) {
          e.closed = true;
          e.live.discard("connection_closed");
          e.cancel.cancel();
          this.entries.delete(threadId);
          this.scheduleWatch();
        }
      },
    };
  }

  /** Stops reading a Thread nobody is looking at, and keeps what it has. */
  private pauseEntry(entry: ThreadEntry): void {
    if (entry.paused || entry.closed) return;
    entry.paused = true;
    entry.refreshAfterHandoff = false;
    entry.live.invalidate();
    entry.cancel.cancel();
    entry.history.value = { ...entry.history.peek(), loading: false, loadingMore: false };
    this.scheduleWatch();
  }

  /** A later read asks only for what's new, unless a first walk was cancelled before it finished. */
  private resumeEntry(entry: ThreadEntry): void {
    if (!entry.paused || entry.closed) return;
    entry.paused = false;
    entry.cancel = new Cancel();
    entry.live.reconcile();
    this.scheduleWatch();
    if (this.canRead()) this.requestThread(entry.id);
  }

  /** Re-read everything tracked (what `resync` and `owner: restarted` trigger). */
  resyncAll(): Promise<void> {
    this.markFullReads();
    const jobs: Promise<void>[] = [];
    if (this.listRefs > 0) jobs.push(this.refresher.request("list"));
    for (const id of this.entries.keys()) jobs.push(this.requestThread(id));
    return Promise.all(jobs).then(() => undefined);
  }

  // ---- frames ----

  private onEvent(e: LinkEvent): void {
    switch (e.kind) {
      case "open":
        this.flushWatch(); // the bridge session starts with an empty subscription
        break;
      case "closed":
        batch(() => {
          this.ownerSig.value = { state: "unknown" };
          this.markAllStale();
          this.discardAllPreviews("connection_closed");
        });
        break;
      case "invalid_frame":
        this.invalidSig.value = { count: this.invalidSig.value.count + 1, last: e.reason };
        break;
      case "frame":
        this.onFrame(e.frame);
        break;
    }
  }

  private onFrame(f: Extract<LinkEvent, { kind: "frame" }>["frame"]): void {
    switch (f.t) {
      case "hello":
        this.bridgeVersionSig.value = f.bridge_version;
        this.dataDirSig.value = f.data_dir;
        this.listenSig.value = typeof f.listen === "string" ? f.listen : undefined;
        this.appsDirSig.value = typeof f.apps_dir === "string" ? f.apps_dir : undefined;
        this.setOwner(f.owner);
        if (f.owner.state === "connected") { this.notifyHints(); void this.resyncAll(); }
        break;
      case "owner":
        batch(() => {
          this.setOwner(f.owner);
          if (f.event === "restarted") this.discardAllPreviews("owner_restarted");
        });
        if (f.event === "restarted") { this.notifyHints(); void this.resyncAll(); }
        break;
      case "resync":
        this.discardAllPreviews("resync");
        this.notifyHints();
        void this.resyncAll();
        break;
      case "changed":
        // Hints are not data: re-read the saved facts. Untracked Threads are ignored.
        if (f.list && this.listRefs > 0) void this.refresher.request("list");
        for (const id of f.thread_ids) {
          for (const notify of this.hintWatchers.get(id) ?? []) notify();
          const entry = this.entries.get(id);
          if (entry?.live.records.peek().length) {
            entry.refreshAfterHandoff = true;
            entry.history.value = { ...entry.history.peek(), stale: true };
            void this.requestThread(id, false);
            void this.resolveHandoff(entry);
          } else this.refreshHint(id);
        }
        break;
      case "live":
        this.entries.get(f.thread_id)?.live.apply(f);
        break;
      case "live_end": {
        const entry = this.entries.get(f.thread_id);
        if (!entry) break;
        entry.live.finish();
        void this.resolveHandoff(entry);
        void this.requestThread(f.thread_id, false); // history ownership is reconciled separately
        break;
      }
      case "error":
        this.bridgeErrorSig.value = { code: f.error.code, message: f.error.message };
        break;
    }
  }

  private setOwner(owner: OwnerState): void {
    const previous = this.ownerSig.peek();
    if (previous.state === "connected" && owner.state === "connected" && previous.info.instance_id !== owner.info.instance_id) this.discardAllPreviews("owner_restarted");
    this.ownerSig.value = owner;
    if (owner.state === "unreachable") {
      this.markAllStale();
      this.discardAllPreviews("owner_unreachable");
    }
  }

  private markAllStale(): void {
    const l = this.listSig.value;
    if (l.loaded) this.listSig.value = { ...l, stale: true };
    for (const e of this.entries.values()) {
      const d = e.detail.value;
      if (d.value !== undefined) e.detail.value = { ...d, stale: true };
      const w = e.work.value;
      if (w.value !== undefined) e.work.value = { ...w, stale: true };
      const h = e.history.value;
      if (h.loaded) e.history.value = { ...h, stale: true };
    }
  }

  private markFullReads(): void {
    for (const e of this.entries.values()) e.fullRead = true;
  }

  private discardAllPreviews(reason: PreviewDiscardReason): void {
    for (const e of this.entries.values()) {
      e.refreshAfterHandoff = false;
      e.resolveAgain = false;
      e.publicationWindow.clear();
      const lifetime = e.live.lifetime;
      e.live.discard(reason);
      if (e.live.lifetime !== lifetime + 1 || e.closed) continue;
      const current = e.history.peek();
      if (current.items.some(item => item.assistant_publication)) e.history.value = {
        ...current, items: current.items.map(item => item.assistant_publication ? { ...item, assistant_publication: { state: "unknown" } } : item),
      };
    }
  }

  // ---- subscription ----

  private scheduleWatch(): void {
    if (this.watchQueued) return;
    this.watchQueued = true;
    void Promise.resolve().then(() => {
      this.watchQueued = false;
      this.flushWatch();
    });
  }

  private flushWatch(): void {
    const watched = [...new Set([...this.entries.values()].filter((e) => !e.paused).map((e) => e.id).concat([...this.hintWatchers.keys()]))];
    this.link.watch(watched, this.listRefs > 0);
  }

  // ---- reads ----

  private canRead(): boolean {
    return this.link.connection.value === "open" && this.ownerSig.value.state === "connected";
  }

  private requestThread(id: string, history = true): Promise<void> {
    if (this.entries.get(id)?.paused) return Promise.resolve();
    return Promise.all([this.refresher.request(`thread:${id}`), ...(history ? [this.refresher.request(`history:${id}`)] : []), ...(this.entries.get(id)?.workRefs ? [this.refresher.request(`work:${id}`)] : [])]).then(
      () => undefined,
    );
  }

  private async read(key: string, onSent: () => void): Promise<void> {
    if (key === "list") return this.readList(onSent);
    const sep = key.indexOf(":");
    const kind = key.slice(0, sep);
    const entry = this.entries.get(key.slice(sep + 1));
    if (!entry) return; // closed since the request
    if (kind === "thread") return this.readDetail(entry, onSent);
    if (kind === "work") return this.readWork(entry, onSent);
    if (this.ownerSig.peek().state === "connected" && this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW)) {
      entry.history.value = { ...entry.history.peek(), stale: false };
      entry.historyTick.value++; // positional reads: nothing is walked, the window reader decides what to read
      return;
    }
    return this.readHistory(entry, onSent);
  }

  private listFilterRead: ListFilter | undefined;
  private listCancel: Cancel | undefined;

  private async readList(onSent: () => void): Promise<void> {
    if (this.listRefs === 0) return;
    const gen = ++this.listGen;
    const filter = this.filterSig.value;
    this.listSig.value = { ...this.listSig.value, loading: true, loadingMore: false };
    this.listCancel = new Cancel();
    const out = await this.operations.threadList(listArgs(filter), { onSent, cancel: this.listCancel });
    if (gen !== this.listGen || filter !== this.filterSig.value) return; // superseded; a newer read follows
    const cur = this.listSig.value;
    if (!out.ok) {
      this.listSig.value = { ...cur, loading: false, stale: cur.loaded, error: out.error };
      return;
    }
    // One call per hint, whatever was expanded: the first page is read again and rows further down are
    // kept, so a hint doesn't collapse the list. A kept row can be stale until the next full read.
    const expanded = this.listFilterRead === filter && cur.items.length > PAGE_LIMIT;
    this.listFilterRead = filter;
    this.listSig.value = {
      items: expanded ? mergeRows(out.value.items, cur.items) : out.value.items,
      nextCursor: expanded ? cur.nextCursor : out.value.next_cursor,
      loaded: true,
      loading: false,
      loadingMore: false,
      stale: false,
      error: undefined,
    };
  }

  private async readDetail(entry: ThreadEntry, onSent: () => void): Promise<void> {
    entry.detail.value = { ...entry.detail.value, loading: true };
    const out = await this.operations.threadGet(entry.id, { onSent, cancel: entry.cancel });
    if (entry.closed) return;
    const cur = entry.detail.value;
    if (!out.ok && out.error.kind === "cancelled") {
      entry.detail.value = { ...cur, loading: false };
      return;
    }
    entry.detail.value = out.ok
      ? { value: out.value, loading: false, stale: false, error: undefined }
      : { ...cur, loading: false, stale: cur.value !== undefined, error: out.error };
  }

  private handoffScope(entry: ThreadEntry): string {
    const owner = this.ownerSig.peek();
    return JSON.stringify([owner.state === "connected" ? owner.info.instance_id : null, entry.id, entry.live.lifetime]);
  }

  private refreshHint(id: string): void {
    if (this.entries.has(id)) void this.requestThread(id);
  }

  /** ADR-C1: one resolver, at most eight starts until explicit retry/open. Hints never refill. */
  private resolveHandoff(entry: ThreadEntry): Promise<void> {
    if (entry.resolving) { entry.resolveAgain = true; return entry.resolving; }
    if (this.publicationRead) return Promise.resolve();
    if (this.handoffRead) { entry.resolveAgain = true; return this.handoffRead.done; }
    const epoch = entry.live.epoch;
    const cancelled = entry.cancel;
    const valid = () => !entry.closed && !entry.paused && epoch === entry.live.epoch && !cancelled.cancelled && cancelled === entry.cancel && this.canRead();
    entry.resolving = Promise.resolve().then(async () => {
      const targets = entry.live.records.peek().filter(r => r.status === "confirming" || r.status === "failed");
      if (!targets.length || !valid() || !entry.live.takeRead()) return;
      const out = await this.operations.handoffAttempts(entry.id, { cancel: cancelled });
      if (!valid()) return;
      if (!out.ok) { if (out.error.kind !== "cancelled") for (const r of targets) entry.live.fail(r.attemptId); return; }
      for (const record of targets) {
        const attempt = out.value.items.find(i => i.kind === "attempt" && i.attempt_id === record.attemptId && i.thread_id === entry.id && typeof i.turn_id === "string");
        if (!attempt || attempt.response_nodes_truncated !== false || !Array.isArray(attempt.response_nodes)) continue;
        const refs = attempt.response_nodes;
        if (refs.length > 64 || refs.some(r => !r || typeof r.kind !== "string" || typeof r.node_id !== "string" || !Number.isSafeInteger(r.ordinal) || r.ordinal < 0)) continue;
        // #279 supplies identity, not body spans. Only the approved final-answer projection is used.
        const finals = refs.filter(r => r.kind === "message" && r.phase === "final_answer");
        if (finals.length !== 1 || refs.some(r => r.kind === "message" && r.phase !== "final_answer" && r.phase !== "commentary")) continue;
        const ref = finals[0]!;
        if (typeof ref.node_id !== "string" || !["completed", "failed", "incomplete", "cancelled"].includes(attempt.state)) continue;
        if (!entry.live.takeRead()) return;
        entry.live.confirming(record.attemptId);
        if (!valid()) return;
        const anchor = await this.operations.historyWindow({ thread_id: entry.id, node_id: ref.node_id, before: 0, after: 0, excerpt_chars: 0 }, { cancel: cancelled });
        if (!valid()) return;
        if (!anchor.ok) { if (anchor.error.kind !== "cancelled") entry.live.fail(record.attemptId); continue; }
        if (anchor.value.thread_id !== entry.id || !anchor.value.items.some(i => i.node_id === ref.node_id && i.kind === "assistant_response")) continue;
        if (!entry.live.takeRead()) return;
        const body = await this.operations.historyGet({ node_id: ref.node_id, end_message_only: true, limit_bytes: 262144 }, { cancel: cancelled });
        if (!valid()) return;
        if (!body.ok) { if (body.error.kind !== "cancelled") entry.live.fail(record.attemptId); continue; }
        // Empty projection can mean no eligible message; partial pages are not a complete saved body.
        if (body.value.node_id !== ref.node_id || body.value.kind !== "assistant_response" || body.value.next_cursor || !body.value.text) continue;
        if (!entry.live.takeRead() || !valid()) return;
        const verify = await this.operations.historyWindow({ thread_id: entry.id, node_id: ref.node_id, before: 0, after: 0, excerpt_chars: 0 }, { cancel: cancelled });
        if (!valid()) return;
        if (!verify.ok) { if (verify.error.kind !== "cancelled") entry.live.fail(record.attemptId); continue; }
        if (verify.value.thread_id !== entry.id || verify.value.revision !== anchor.value.revision || !verify.value.items.some(i => i.node_id === ref.node_id && i.selection?.ordinal === anchor.value.items.find(i => i.node_id === ref.node_id)?.selection?.ordinal)) continue;
        const item = anchor.value.items.find(i => i.node_id === ref.node_id)!;
        if (!Number.isSafeInteger(item.selection?.ordinal)) continue;
        batch(() => entry.live.ready(record.attemptId, ref.node_id, body.value.text, Object.freeze({ scope: this.handoffScope(entry), turnId: attempt.turn_id!, ordinal: item.selection!.ordinal!, revision: anchor.value.revision, kind: "assistant_response" })));
      }
    }).finally(() => {
      entry.resolving = undefined;
      if (this.handoffRead?.entry === entry) this.handoffRead = undefined;
      const waiting = [...this.entries.values()].find(e => e !== entry && e.resolveAgain && !e.closed && !e.paused);
      if (waiting) { waiting.resolveAgain = false; void this.resolveHandoff(waiting); }
      if (entry.resolveAgain) { entry.resolveAgain = false; if (!entry.closed && !entry.paused) { void this.resolveHandoff(entry); return; } }
      if (entry.refreshAfterHandoff && !entry.live.records.peek().some(r => r.status === "failed")) {
        entry.refreshAfterHandoff = false; if (!entry.closed && !entry.paused) this.refreshHint(entry.id);
      }
    });
    this.handoffRead = { entry, done: entry.resolving };
    return entry.resolving;
  }

  private async readWork(entry: ThreadEntry, onSent: () => void): Promise<void> {
    if (entry.workRefs === 0 || entry.paused) return;
    entry.work.value = { ...entry.work.value, loading: true };
    const out = await this.operations.threadWork(entry.id, { onSent, cancel: entry.cancel });
    if (entry.closed) return;
    let value = out.ok ? out.value : undefined;
    if (value && entry.workRefs > 0 && !entry.paused) {
      // Only the first eight pending originals are read. The cache belongs to this open
      // Thread and is replaced on every observation, so neither memory nor reads grow.
      const ids = value.items.filter((i) => i.kind === "message" && i.message_id && ["accepted", "held"].includes(i.state)).slice(0, 8).map((i) => i.message_id!);
      const bodies = await Promise.all(ids.map(async (id) => {
        const cached = entry.workBodies.get(id);
        if (cached !== undefined) return [id, cached] as const;
        const body = await this.operations.historyGet({ node_id: id, limit_bytes: 1024 }, { cancel: entry.cancel });
        return [id, body.ok && body.value.kind === "user" ? body.value.text : undefined] as const;
      }));
      if (entry.closed) return;
      entry.workBodies = new Map(bodies.filter((pair): pair is readonly [string, string] => pair[1] !== undefined));
      value = { ...value, items: value.items.map((item) => {
        const text = item.message_id ? entry.workBodies.get(item.message_id) : undefined;
        return text !== undefined ? { ...item, excerpt: text } : item;
      }) };
    }
    const cur = entry.work.value;
    if (entry.workRefs === 0 || entry.paused || (!out.ok && out.error.kind === "cancelled")) {
      entry.work.value = { ...cur, loading: false };
      return;
    }
    entry.work.value = out.ok
      ? { value: value!, loading: false, stale: false, error: undefined }
      : { ...cur, loading: false, stale: cur.value !== undefined, error: out.error };
  }

  private async qualifyPublication(entry: ThreadEntry, items: HistoryItem[], cancel: Cancel, valid: () => boolean): Promise<void> {
    const pending = items.filter(item => item.assistant_publication?.state === "unknown" && entry.live.claimPublication(item.node_id!)).slice(0, 8);
    if (!valid()) return;
    if (pending.length && !this.handoffRead && !this.publicationRead && entry.live.takeRead()) {
      this.publicationRead = true;
      try {
        const refs = await this.operations.handoffAttempts(entry.id, { cancel });
        if (!valid()) return;
        for (const item of pending) {
          if (!refs.ok) { item.assistant_publication = { state: "unknown", error: true }; continue; }
          const candidates = refs.value.items.filter(attempt => attempt.kind === "attempt" && attempt.thread_id === entry.id && typeof attempt.attempt_id === "string" && attempt.attempt_id.trim() !== "" && typeof attempt.turn_id === "string" && attempt.turn_id.trim() !== "" && attempt.response_nodes_truncated === false && Array.isArray(attempt.response_nodes) && attempt.response_nodes.length <= 64 && attempt.response_nodes.some(ref => ref?.node_id === item.node_id));
          if (refs.value.next_cursor || refs.value.items.some(other => other.response_nodes != null && !Array.isArray(other.response_nodes)) || candidates.length !== 1) continue;
          const attempt = candidates[0]!;
          if (refs.value.items.some(other => other !== attempt && Array.isArray(other.response_nodes) && other.response_nodes.some(ref => ref?.node_id === item.node_id))) continue;
          entry.live.claimPublication(item.node_id!, attempt.attempt_id!);
          const all = attempt.response_nodes!;
          if (!["completed", "failed", "incomplete", "cancelled"].includes(attempt.state)) continue;
          if (all.some(ref => !ref || typeof ref.node_id !== "string" || !Number.isSafeInteger(ref.ordinal) || ref.ordinal < 0 || typeof ref.kind !== "string")) continue;
          if (new Set(all.map(ref => ref.ordinal)).size !== all.length) continue;
          const nodeRefs = all.filter(ref => ref.node_id === item.node_id);
          const tool = nodeRefs.find(ref => ref.kind === "function_call");
          if (tool) item.assistant_publication = { state: "tool", attemptId: attempt.attempt_id!, ordinal: tool.ordinal, kind: tool.kind };
          else if (nodeRefs.length === 1 && nodeRefs[0]!.kind === "message" && nodeRefs[0]!.phase === "final_answer") item.assistant_publication = { state: "message", attemptId: attempt.attempt_id!, ordinal: nodeRefs[0]!.ordinal, kind: "message" };
        }
      } finally { this.publicationRead = false; }
    }
  }

  private async readHistory(entry: ThreadEntry, onSent: () => void): Promise<void> {
    const gen = ++entry.historyGen;
    const before = entry.history.peek();
    const olderPage = before.loadingMore;
    const cancel = entry.cancel;
    const epoch = entry.live.epoch;
    const valid = () => !entry.closed && !entry.paused && entry.historyGen === gen && entry.cancel === cancel && !cancel.cancelled && entry.live.epoch === epoch && this.canRead();
    entry.history.value = { ...entry.history.peek(), loading: true };
    if (!valid()) return;
    const out = await this.walkHistory(entry, gen, onSent);
    if (!valid()) return;
    if (out.ok) {
      const old = new Map(before.items.map(item => [item.node_id, item]));
      out.items = out.items.map(rawItem => {
        const { assistant_publication: _untrusted, ...item } = rawItem;
        const prior = old.get(item.node_id);
        const knownTool = entry.work.peek().value?.items.some(attempt => attempt.thread_id === entry.id && attempt.response_nodes_truncated === false && Array.isArray(attempt.response_nodes) && attempt.response_nodes.some(ref => ref?.node_id === item.node_id && ref.kind === "function_call"));
        return item.kind === "assistant_response" && item.node_id
          ? prior?.assistant_publication ? { ...item, assistant_publication: prior.assistant_publication }
            : ((before.loaded || entry.publicationTail !== undefined) && !olderPage && !prior) || knownTool ? { ...item, assistant_publication: { state: "unknown" as const } } : item
          : item;
      });
      await this.qualifyPublication(entry, out.items, cancel, valid);
      if (!valid()) return;
    }
    if (entry.closed || gen !== entry.historyGen) return;
    const cur = entry.history.value;
    if (!out.ok && out.error.kind === "cancelled") {
      entry.history.value = { ...cur, loading: false, loadingMore: false };
      return;
    }
    entry.history.value = out.ok
      ? { items: out.items, earlierHidden: out.earlierHidden, loaded: true, loading: false, loadingMore: false, stale: false, error: undefined }
      : { ...cur, loading: false, loadingMore: false, stale: cur.loaded, error: out.error };
  }

  /**
   * `history.list` runs oldest to newest and has no way to start at the end, and any append
   * expires its cursors. So the first read walks the whole path keeping a window of the newest
   * items, and later reads ask only for items since the last known one. If that item moved or
   * vanished, the path was rewritten (compaction, rewind) and the walk starts over.
   */
  private async walkHistory(
    entry: ThreadEntry,
    gen: number,
    onSent: () => void,
  ): Promise<{ ok: true; items: HistoryItem[]; earlierHidden: boolean } | { ok: false; error: OpError }> {
    const cur = entry.history.value;
    const fresh = entry.fullRead;
    entry.fullRead = false;
    let items = fresh ? [] : cur.items;
    let earlierHidden = fresh ? false : cur.earlierHidden;
    let cursor: string | undefined;
    let anchor = anchorOf(items);
    let retries = 0;
    let first = true;
    const startOver = () => {
      items = [];
      earlierHidden = false;
      anchor = undefined;
      cursor = undefined;
    };
    if (items.length > 0 && !anchor) startOver();
    for (;;) {
      const out = await this.operations.historyList(
        {
          thread_id: entry.id,
          limit: HISTORY_PAGE_LIMIT,
          excerpt_chars: HISTORY_EXCERPT_CHARS,
          ...(anchor?.since !== undefined && { since: anchor.since }),
          ...(cursor !== undefined && { cursor }),
        },
        first ? { onSent, cancel: entry.cancel } : { cancel: entry.cancel },
      );
      first = false;
      if (entry.closed || gen !== entry.historyGen) return { ok: true, items: [], earlierHidden: false };
      if (!out.ok) {
        if (out.error.kind !== "owner" || out.error.code !== "cursor_expired" || ++retries > HISTORY_READ_RETRIES) {
          entry.fullRead = fresh;
          return { ok: false, error: out.error };
        }
        // Something was appended: continue from the last item this walk knows.
        cursor = undefined;
        anchor = anchorOf(items);
        if (items.length > 0 && !anchor) startOver();
        continue;
      }
      if (cursor === undefined && anchor && !confirmsAnchor(out.value.items, anchor)) {
        if (++retries > HISTORY_READ_RETRIES)
          return { ok: false, error: { kind: "invalid_response", message: "history path keeps changing" } };
        startOver();
        continue;
      }
      items = mergeItems(items, out.value.items);
      if (items.length > entry.window) {
        items = items.slice(items.length - entry.window);
        earlierHidden = true;
      }
      cursor = out.value.next_cursor;
      if (cursor === undefined) return { ok: true, items, earlierHidden };
    }
  }

  /** Show more of the path: a larger window needs a new walk, the owner cannot read backwards. */
  private async loadOlder(entry: ThreadEntry): Promise<void> {
    const cur = entry.history.value;
    if (!cur.earlierHidden || cur.loadingMore || cur.loading || entry.window >= HISTORY_WINDOW_MAX) return;
    entry.window = Math.min(entry.window * 2, HISTORY_WINDOW_MAX);
    entry.fullRead = true;
    entry.history.value = { ...cur, loadingMore: true };
    await this.refresher.request(`history:${entry.id}`);
  }
}

interface Anchor {
  nodeId: string;
  ordinal: number | undefined;
  since: string;
}

function anchorOf(items: HistoryItem[]): Anchor | undefined {
  const last = items[items.length - 1];
  const since = last?.provenance?.created_at;
  if (!last || last.node_id === undefined || since === undefined) return undefined;
  return { nodeId: last.node_id, ordinal: last.selection?.ordinal, since };
}

const confirmsAnchor = (page: HistoryItem[], anchor: Anchor): boolean =>
  page.some((i) => i.node_id === anchor.nodeId && i.selection?.ordinal === anchor.ordinal);

/** Union by node id: a re-read item replaces its older copy, new items follow in path order. */
function mergeItems(known: HistoryItem[], page: HistoryItem[]): HistoryItem[] {
  if (known.length === 0) return page;
  const index = new Map(known.map((item, i) => [item.node_id, i]));
  const merged = [...known];
  for (const item of page) {
    const at = index.get(item.node_id);
    if (at === undefined) merged.push(item);
    else merged[at] = item;
  }
  return merged;
}

function listArgs(filter: ListFilter) {
  const args: { limit: number; query?: string; archived?: ArchivedFilter } = { limit: PAGE_LIMIT };
  if (filter.query) args.query = filter.query;
  if (filter.archived) args.archived = filter.archived;
  return args;
}

/**
 * The owner accepts a client's operation ID only as `<instance_id>:<id>` (found on the real owner:
 * a bare UUID is refused with "operation ID has no active instance prefix"). Before the instance
 * is known the ID stays bare, and the owner's refusal is reported rather than hidden.
 */
function withInstance(owner: OwnerView, id: string): string {
  const instance = owner.state === "connected" ? owner.info.instance_id : null;
  return instance ? `${instance}:${id}` : id;
}

function defaultNewId(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) throw new Error("no crypto.randomUUID: pass newId");
  return c.randomUUID();
}
