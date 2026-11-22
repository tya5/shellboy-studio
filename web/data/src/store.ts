import type { HistoryWindowInput } from './history-input';
import { Handoff, type HandoffRecord } from "./handoff";
// The view-model: signals holding saved facts re-read through the proxy, never invented.
// Hints (`changed`, `resync`, `owner`) are triggers only; their payloads carry no data.
import { batch, computed, signal, type ReadonlySignal } from "@preact/signals-core";
import type { OpError, Outcome } from "./errors";
import { Link, type ConnectionState, type LinkEvent } from "./link";
import { microtaskSchedule, type Preview, type PreviewDiscardReason, type Schedule } from "./live";
import { Cancel, Operations } from "./operations";
import type {
  HistoryItem,
  HistoryWindowArgs,
  HistoryWindowResult,
  OwnerState,
  ThreadDetails,
  ThreadListArgs,
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
/** The owner reads `history.window` (Shellboy #268). With it, history is read by position and never walked. */
export const CAPABILITY_HISTORY_WINDOW = "history.window";

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

export type ListFilter = Pick<ThreadListArgs, "query" | "archived" | "awaiting" | "tags" | "cwd">;

export type OwnerView = { state: "unknown" } | OwnerState;

export interface Handle {
  close(): void;
}

/** One borrowed detail observation, qualified by its successful read's owner epoch. */
export interface ThreadDetailObservation {
  readonly value: ThreadDetails;
  isCurrent(): boolean;
}

export interface ThreadHandle extends Handle {
  captureDetail(): ThreadDetailObservation | undefined;
  readonly threadId: string;
  readonly detail: ReadonlySignal<Resource<ThreadDetails>>;
  readonly work: ReadonlySignal<Resource<Page<WorkItem>>>;
  setWorkActive(active: boolean): void;
  readonly preview: ReadonlySignal<Preview>;
  readonly handoff: ReadonlySignal<readonly HandoffRecord[]>;
  readonly handoffOverflow: ReadonlySignal<boolean>;
  liveEpoch(): number;
  readonly liveEpochSignal: ReadonlySignal<number>;
  releaseAcceptedHandoff(attemptId: string): void;
  /** Counts hints for this Thread's history while the owner has `history.window`; the window reader follows it. */
  readonly historyTick: ReadonlySignal<number>;
  /** One positional read. Nothing is sent for a closed or paused Thread. */
  readWindow(args: Omit<HistoryWindowArgs, "thread_id">, cancel: Cancel): Promise<Outcome<HistoryWindowInput>>;
  /** Cancels this Thread's reads (what leaving the view does). */
  cancelReads(): void;
  refresh(): Promise<void>;
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
  detailOwnerEpoch = -1;
  detail = signal<Resource<ThreadDetails>>({ value: undefined, loading: false, stale: false, error: undefined });
  work = signal<Resource<Page<WorkItem>>>({ value: undefined, loading: false, stale: false, error: undefined });
  workRefs = 0;
  workGen = 0;
  workBodies = new Map<string, string>();
  /** Unsaved model text; its signal is the handle's `preview`. */
  live: Handoff;
  historyTick = signal(0);
  /** Cancels this Thread's reads: dropped if queued, a `cancel` frame if sent. Replaced on resume. */
  cancel = new Cancel();
  /** Nobody is looking: no reads, and no hints from the bridge. */
  paused = false;
  constructor(readonly id: string, schedule: Schedule, nextOrdinal: () => number) {
    this.live = new Handoff(schedule, nextOrdinal);
  }
  get preview(): ReadonlySignal<Preview> {
    return this.live.preview;
  }
}

/** Negative body exclusivity needs complete attribution across the bounded observed Thread scope. */

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

  private readonly desktopSig = signal(false);
  readonly desktop: ReadonlySignal<boolean> = this.desktopSig;
  private readonly desktopDiagnosticSig = signal<string | null>(null);
  readonly desktopDiagnostic: ReadonlySignal<string | null> = this.desktopDiagnosticSig;

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
  private watchQueued = false;
  readonly listHint = signal(0);
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
    this.operations = new Operations(this.link, () => withInstance(this.ownerSig.peek(), newId()), () => this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW));
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
    ++this.readQualificationEpoch;
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
  openThread(threadId: string, nextOrdinal: () => number): ThreadHandle {
    let entry = this.entries.get(threadId);
    if (!entry) {
      if (!this.hintWatchers.has(threadId) && new Set([...this.entries.keys(), ...this.hintWatchers.keys()]).size >= MAX_WATCHED_THREADS)
        throw new RangeError(`at most ${MAX_WATCHED_THREADS} Threads can be open at once`);
      entry = new ThreadEntry(threadId, this.schedule, nextOrdinal);
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
    const handleClosed = signal(false);
    let watchingWork = false;
    const setWorkActive = (active: boolean) => {
      if (closed || watchingWork === active) return;
      watchingWork = active;
      e.workRefs += active ? 1 : -1;
      if (active && e.workRefs === 1 && !e.paused && this.canRead()) void this.refresher.request(`work:${threadId}`);
    };
    const readable = () => !closed && !e.closed && !e.paused && !e.cancel.cancelled && this.entries.get(threadId) === e && this.canRead();
    return {
      captureDetail: () => {
        const epoch = this.readQualificationEpoch;
        const cancel = e.cancel;
        const valid = () => readable() && epoch === this.readQualificationEpoch && cancel === e.cancel
          && e.detailOwnerEpoch === epoch && !e.detail.peek().stale && !e.detail.peek().error;
        const value = e.detail.peek().value;
        return value && valid() ? { value, isCurrent: valid } : undefined;
      },
      threadId,
      detail: e.detail,
      work: e.work,
      setWorkActive,
      preview: e.preview,
      handoff: e.live.records,
      handoffOverflow: e.live.overflow,
      liveEpoch: () => e.live.epoch,
      liveEpochSignal: e.live.epochSignal,
      releaseAcceptedHandoff: attemptId => { if (!closed && !e.closed) e.live.releaseAccepted(attemptId); },
      historyTick: e.historyTick,
      readWindow: async (args, cancel) => {
        if (e.closed || e.paused) return Promise.resolve({ ok: false, error: { kind: "cancelled", message: "thread is not being read" } });
        if (!this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW)) return Promise.resolve({ ok: false, error: { kind: "invalid_response", message: "owner does not advertise history.window" } });
        const epoch = e.live.epoch;
        const valid = () => !closed && !e.closed && !e.paused && !cancel.cancelled && epoch === e.live.epoch && this.canRead();
        const out = await this.operations.historyWindow({ thread_id: threadId, ...args }, { cancel });
        if (!out.ok || !valid()) return out.ok ? { ok: false, error: { kind: "cancelled", message: "window owner changed" } } : out;
        if (out.value.thread_id !== threadId) return { ok: false, error: { kind: "cancelled", message: "window Thread mismatch" } };
        // Saved ordinary nodes are independent of overlay/publication evidence.
        const saved = out.value;
        if (!valid()) return { ok: false, error: { kind: "cancelled", message: "window owner changed while materializing" } };
        return { ok: true, value: saved };
      },
      cancelReads: () => batch(() => { e.live.advanceEpoch(); e.cancel.cancel(); }),
      refresh: () => this.requestThread(threadId),
      pause: () => this.pauseEntry(e),
      resume: () => this.resumeEntry(e),
      close: () => {
        if (closed) return;
        closed = true;
        handleClosed.value = true;
        // setWorkActive normally rejects a closed handle; release its ownership directly.
        if (watchingWork) { watchingWork = false; e.workRefs--; }
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
    batch(() => {
      entry.paused = true;
      entry.live.advanceEpoch();
      entry.cancel.cancel();
      this.scheduleWatch();
    });
  }

  /** A later read asks only for what's new, unless a first walk was cancelled before it finished. */
  private resumeEntry(entry: ThreadEntry): void {
    if (!entry.paused || entry.closed) return;
    batch(() => {
      entry.paused = false;
      entry.cancel = new Cancel();
      entry.live.advanceEpoch();
      this.scheduleWatch();
    });
    if (this.canRead()) this.requestThread(entry.id);
  }

  /** Re-read everything tracked (what `resync` and `owner: restarted` trigger). */
  resyncAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    if (this.listRefs > 0) jobs.push(this.refresher.request("list"));
    for (const id of this.entries.keys()) jobs.push(this.requestThread(id));
    return Promise.all(jobs).then(() => undefined);
  }

  // ---- frames ----

  private readQualificationEpoch = 0;

  private onEvent(e: LinkEvent): void {
    switch (e.kind) {
      case "open":
        ++this.readQualificationEpoch;
        this.flushWatch(); // the bridge session starts with an empty subscription
        break;
      case "closed":
        ++this.readQualificationEpoch;
        batch(() => {
          this.desktopSig.value = false;
          this.desktopDiagnosticSig.value = null;
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
        this.desktopSig.value = f.desktop === true;
        this.bridgeVersionSig.value = f.bridge_version;
        this.dataDirSig.value = f.data_dir;
        this.listenSig.value = typeof f.listen === "string" ? f.listen : undefined;
        this.appsDirSig.value = typeof f.apps_dir === "string" ? f.apps_dir : undefined;
        this.setOwner(f.owner);
        if (f.owner.state === "connected") { this.notifyHints(); void this.resyncAll(); }
        break;
      case "launcher_diagnostic":
        this.desktopDiagnosticSig.value = f.message;
        break;
      case "owner":
        batch(() => {
          this.setOwner(f.owner);
          if (f.event === "restarted") this.discardAllPreviews("owner_restarted");
        });
        if (f.event === "restarted") { this.notifyHints(); void this.resyncAll(); }
        break;
      case "resync":
        if (this.listRefs > 0) this.listHint.value++;
        this.discardAllPreviews("resync");
        this.notifyHints();
        void this.resyncAll();
        break;
      case "changed":
        // Hints are not data: re-read the saved facts. Untracked Threads are ignored.
        if (f.list && this.listRefs > 0) { this.listHint.value++; void this.refresher.request("list"); }
        for (const id of f.thread_ids) {
          for (const notify of this.hintWatchers.get(id) ?? []) notify();
          this.refreshHint(id);
        }
        break;
      case "live":
        { const entry=this.entries.get(f.thread_id);
          entry?.live.apply(f); }
        break;
      case "attempt_end":
        this.entries.get(f.thread_id)?.live.end(f.attempt_id, f.outcome);
        break;
      case "live_end": {
        const entry = this.entries.get(f.thread_id);
        if (!entry) break;
        entry.live.finish();
        void this.requestThread(f.thread_id, false); // history ownership is reconciled separately
        break;
      }
      case "error":
        this.bridgeErrorSig.value = { code: f.error.code, message: f.error.message };
        break;
    }
  }

  private setOwner(owner: OwnerState): void {
    ++this.readQualificationEpoch;
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
    }
  }

  private discardAllPreviews(reason: PreviewDiscardReason): void {
    // Revoke every old read before any synchronous clear/discard observer can run.
    batch(() => {
      ++this.readQualificationEpoch;
      for (const e of this.entries.values()) {
        e.live.advanceEpoch();
        e.live.discard(reason);
      }
    });
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
    const readWindow = history && this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW);
    return Promise.all([this.refresher.request(`thread:${id}`), ...(readWindow ? [this.refresher.request(`history:${id}`)] : []), ...(this.entries.get(id)?.workRefs ? [this.refresher.request(`work:${id}`)] : [])]).then(
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
    if (kind !== "history" || !this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW)) return;
    entry.historyTick.value++; // notification only; positional reads own history admission
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
    const epoch = this.readQualificationEpoch;
    const cancel = entry.cancel;
    entry.detail.value = { ...entry.detail.value, loading: true };
    const out = await this.operations.threadGet(entry.id, { onSent, cancel });
    if (entry.closed || epoch !== this.readQualificationEpoch || cancel !== entry.cancel || cancel.cancelled) return;
    const cur = entry.detail.value;
    if (!out.ok && out.error.kind === "cancelled") {
      entry.detail.value = { ...cur, loading: false };
      return;
    }
    if (out.ok) entry.detailOwnerEpoch = epoch;
    entry.detail.value = out.ok
      ? { value: out.value, loading: false, stale: false, error: undefined }
      : { ...cur, loading: false, stale: cur.value !== undefined, error: out.error };
  }

  private refreshHint(id: string): void {
    if (this.entries.has(id)) void this.requestThread(id);
  }

  /** ADR-C1: one resolver, at most eight starts until explicit retry/open. Hints never refill. */
  private async readWork(entry: ThreadEntry, onSent: () => void): Promise<void> {
    if (entry.workRefs === 0 || entry.paused) return;
    const cancel = entry.cancel; const epoch = entry.live.epoch;
    const generation = ++entry.workGen; const owner = this.ownerSig.peek();
    const valid = () => generation === entry.workGen && owner === this.ownerSig.peek() && !entry.closed && !entry.paused && entry.workRefs > 0 && entry.cancel === cancel && !cancel.cancelled && epoch === entry.live.epoch && this.canRead();
    entry.work.value = { ...entry.work.value, loading: true };
    if (!valid()) return;
    const out = await this.operations.threadWork(entry.id, { onSent, cancel });
    if (!valid()) return;
    let value = out.ok ? out.value : undefined;
    if (value && entry.workRefs > 0 && !entry.paused) {
      // Only the first eight pending originals are read. The cache belongs to this open
      // Thread and is replaced on every observation, so neither memory nor reads grow.
      const ids = value.items.filter((i) => i.kind === "message" && i.message_id && ["accepted", "held"].includes(i.state)).slice(0, 8).map((i) => i.message_id!);
      const bodies = await Promise.all(ids.map(async (id) => {
        const cached = entry.workBodies.get(id);
        if (cached !== undefined) return [id, cached] as const;
        if (!valid()) return [id, undefined] as const;
        const body = await this.operations.historyGet({ node_id: id, limit_bytes: 1024 }, { cancel });
        return [id, body.ok && body.value.kind === "user" ? body.value.text : undefined] as const;
      }));
      if (!valid()) return;
      entry.workBodies = new Map(bodies.filter((pair): pair is readonly [string, string] => pair[1] !== undefined));
      value = { ...value, items: value.items.map((item) => {
        const text = item.message_id ? entry.workBodies.get(item.message_id) : undefined;
        return text !== undefined ? { ...item, excerpt: text } : item;
      }) };
    }
    if (!valid()) return;
    const cur = entry.work.value;
    if (entry.workRefs === 0 || entry.paused || (!out.ok && out.error.kind === "cancelled")) {
      entry.work.value = { ...cur, loading: false };
      return;
    }
    entry.work.value = out.ok
      ? { value: value!, loading: false, stale: false, error: undefined }
      : { ...cur, loading: false, stale: cur.value !== undefined, error: out.error };
  }


}

function listArgs(filter: ListFilter): ThreadListArgs {
  return { ...filter, limit: PAGE_LIMIT };
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
