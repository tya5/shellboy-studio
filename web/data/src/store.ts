import type { DefinitionKind, ShellDefinition } from "./schedules";
import type { HistoryWindowInput } from './history-input';
import { Handoff, type HandoffRecord } from "./handoff";
// The view-model: signals holding saved facts re-read through the proxy, never invented.
// Hints (`changed`, `resync`, `owner`) are triggers only; their payloads carry no data.
import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import type { OpError, Outcome } from "./errors";
import { Link, type ConnectionState, type LinkEvent } from "./link";
import { microtaskSchedule, type Preview, type PreviewDiscardReason, type Schedule } from "./live";
import { ACTIVE_STATUS_PAGE_LIMIT, Cancel, Operations } from "./operations";
import { isActiveThreadActivity } from "./activity";

import type {
  HistoryItem,
  HistoryWindowArgs,
  HistoryWindowResult,
  OwnerState,
  LauncherState,
  StartupStage,
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
const CAPABILITY_THREAD_TAGS = "thread.tags";

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

/** Keep Needs-you exclusive with Core's query, tag and directory constraints. */
export function normalizeFilter(previous: ListFilter, next: ListFilter): ListFilter {
  const awaitingChanged = previous.awaiting !== next.awaiting;
  const otherChanged = previous.query !== next.query || previous.cwd !== next.cwd
    || JSON.stringify(previous.tags) !== JSON.stringify(next.tags);
  if (next.awaiting && awaitingChanged)
    return { ...next, query: undefined, tags: undefined, cwd: undefined };
  if (next.awaiting && otherChanged)
    return { ...next, awaiting: undefined };
  if (next.awaiting && (next.query !== undefined || !!next.tags?.length || next.cwd !== undefined))
    return { ...next, query: undefined, tags: undefined, cwd: undefined };
  return next;
}

interface ThreadListState extends PagedState<string> {
  /** Filter that produced the published rows and cursor, not the pending request. */
  filter?: Readonly<ListFilter>;
}

/** One paged `thread.list` read into the row cache: the sidebar's All list or its Archive band. */
interface ListPages {
  readonly state: Signal<ThreadListState>;
  gen: number;
  cancel: Cancel | undefined;
  readonly args: (filter: ListFilter) => ThreadListArgs;
}

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
  readonly definitions: Readonly<Record<DefinitionKind, ReadonlySignal<Resource<ReadonlyMap<string, ShellDefinition>>>>>;
  observeDefinitions(): () => void;
  readonly preview: ReadonlySignal<Preview>;
  readonly handoff: ReadonlySignal<readonly HandoffRecord[]>;
  readonly handoffOverflow: ReadonlySignal<boolean>;
  liveEpoch(): number;
  readonly liveEpochSignal: ReadonlySignal<number>;
  captureHandoffReplacement(): readonly HandoffRecord[] | undefined;
  commitHandoffReplacement(): void;
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
  definitionRefs = 0;
  definitions = {
    schedule: signal<Resource<ReadonlyMap<string, ShellDefinition>>>({ value: undefined, loading: false, stale: true, error: undefined }),
    service: signal<Resource<ReadonlyMap<string, ShellDefinition>>>({ value: undefined, loading: false, stale: true, error: undefined }),
  };
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


const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** The same decoded row: every field equal (a hint can change any of them, `updated_at` or not). */
const sameRow = (a: ThreadSummary | undefined, b: ThreadSummary): boolean =>
  a === b || (a !== undefined && JSON.stringify(a) === JSON.stringify(b));

const isActiveSummary = (row: ThreadSummary): boolean =>
  (row.awaiting_named_count ?? 0) > 0 || isActiveThreadActivity(row.activity);

/**
 * Bounded at MAX_LIST_ROWS; the oldest rows go first, but never one in `held`: an open Thread's
 * (at most MAX_WATCHED_THREADS) or one the list, Archive or pinned state still lists (each at most MAX_LIST_ROWS).
 */
function trimRows(rows: Map<string, ThreadSummary>, held: ReadonlySet<string>): Map<string, ThreadSummary> {
  for (const id of rows.keys()) {
    if (rows.size <= MAX_LIST_ROWS) break;
    if (!held.has(id)) rows.delete(id);
  }
  return rows;
}

function rememberRows(previous: ReadonlyMap<string, ThreadSummary>, rows: readonly ThreadSummary[], held: ReadonlySet<string>): ReadonlyMap<string, ThreadSummary> {
  if (rows.every(row => sameRow(previous.get(row.thread_id), row))) return previous;
  const next = new Map(previous);
  for (const row of rows) { next.delete(row.thread_id); next.set(row.thread_id, row); }
  return trimRows(next, held);
}

export class ShellboyData {
  readonly link: Link;
  readonly operations: Operations;

  private readonly desktopSig = signal(false);
  readonly desktop: ReadonlySignal<boolean> = this.desktopSig;
  readonly launcher = signal<LauncherState | null>(null);
  readonly managedInstance = computed(() => this.launcher.value?.instance_id ?? null);
  readonly startupStage = signal<StartupStage | null>(null);
  readonly coreManagement = signal(false);
  readonly coreStatusHint = signal(0);
  private coreStatusRefs = 0;
  watchCoreStatus(): Handle {
    this.coreStatusRefs++;
    this.scheduleWatch();
    let closed = false;
    return { close: () => { if (!closed) { closed = true; this.coreStatusRefs--; this.scheduleWatch(); } } };
  }
  private readonly desktopDiagnosticSig = signal<string | null>(null);
  readonly desktopDiagnostic: ReadonlySignal<string | null> = this.desktopDiagnosticSig;

  private readonly ownerSig = signal<OwnerView>({ state: "unknown" });
  private readonly bridgeVersionSig = signal<string | undefined>(undefined);
  private readonly listenSig = signal<string | undefined>(undefined);
  private readonly dataDirSig = signal<string | undefined>(undefined);
  private readonly invalidSig = signal<{ count: number; last: string | undefined }>({ count: 0, last: undefined });
  private readonly bridgeErrorSig = signal<{ code: string; message: string } | undefined>(undefined);
  private readonly listSig = signal<ThreadListState>(emptyPaged());
  private readonly listPages: ListPages = { state: this.listSig, gen: 0, cancel: undefined, args: listArgs };
  /** The Archive band: the same filter with `archived: "only"`, in pages like the list. */
  private readonly archivePages: ListPages = { state: signal<ThreadListState>(emptyPaged()), gen: 0, cancel: undefined, args: filter => listArgs({ ...filter, archived: "only" }) };
  private readonly threadRowsSig = signal<ReadonlyMap<string, ThreadSummary>>(new Map());
  private readonly pinnedThreadIdsSig = signal<readonly string[]>([]);
  private readonly pinnedMoreSig = signal(false);
  private readonly pinnedErrorSig = signal<OpError | undefined>(undefined);
  private readonly activeThreadIdsSig = signal<readonly string[]>([]);
  private readonly inboxThreadIdsSig = signal<readonly string[]>([]);
  private readonly filterSig = signal<ListFilter>({});
  private listRefs = 0;
  private entries = new Map<string, ThreadEntry>();
  private watchQueued = false;
  private readonly deletionHint = signal<{ ids?: readonly string[] }>({});
  /** A hint without IDs invalidates every open deletion preview. */
  readonly deletePreviewHint: ReadonlySignal<{ ids?: readonly string[] }> = this.deletionHint;
  readonly listHint = signal(0);
  readonly configChanged = signal(0);
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
  /** Undecodable frames seen (count and last reason); a bug indicator, not a user message. */
  readonly invalidFrames: ReadonlySignal<{ count: number; last: string | undefined }>;
  /** Last `error` frame from the bridge (e.g. an invalid watch). */
  readonly bridgeError: ReadonlySignal<{ code: string; message: string } | undefined>;
  readonly threadList: ReadonlySignal<PagedState<ThreadSummary> & { filter?: Readonly<ListFilter> }>;
  readonly threadRows: ReadonlySignal<ReadonlyMap<string, ThreadSummary>>;
  readonly pinnedThreads: ReadonlySignal<readonly ThreadSummary[]>;
  readonly listThreadIds: ReadonlySignal<readonly string[]>;
  readonly threadListMeta: ReadonlySignal<Omit<ThreadListState, "items">>;
  readonly pinnedThreadIds: ReadonlySignal<readonly string[]>;
  /** The pinned read stopped at MAX_LIST_ROWS with a continuation left: the pinned set is a lower bound. */
  readonly pinnedMore: ReadonlySignal<boolean>;
  readonly pinnedError: ReadonlySignal<OpError | undefined>;
  /** Archived Threads for the sidebar's Archive band (`thread.list` with `archived: "only"`); not read while Needs-you is on. */
  readonly archivedList: ReadonlySignal<PagedState<ThreadSummary> & { filter?: Readonly<ListFilter> }>;
  readonly archivedThreadIds: ReadonlySignal<readonly string[]>;
  readonly activeThreadIds: ReadonlySignal<readonly string[]>;
  readonly inboxThreadIds: ReadonlySignal<readonly string[]>;
  readonly listFilter: ReadonlySignal<ListFilter>;

  constructor(options: DataOptions) {
    this.link = new Link(options.transport);
    this.schedule = options.schedule ?? microtaskSchedule;
    const newId = options.newId ?? defaultNewId;
    this.operations = new Operations(this.link, newId, () => this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW));
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
    this.invalidFrames = this.invalidSig;
    this.bridgeError = this.bridgeErrorSig;
    const rowsOf = (state: ThreadListState) => ({ ...state, items: state.items.flatMap(id => { const row = this.threadRowsSig.value.get(id); return row ? [row] : []; }) });
    this.threadList = computed(() => rowsOf(this.listSig.value));
    this.archivedList = computed(() => rowsOf(this.archivePages.state.value));
    this.archivedThreadIds = computed(() => this.archivePages.state.value.items);
    this.threadRows = this.threadRowsSig;
    this.pinnedThreads = computed(() => this.pinnedThreadIdsSig.value.flatMap(id => { const row = this.threadRowsSig.value.get(id); return row ? [row] : []; }));
    this.listThreadIds = computed(() => this.listSig.value.items);
    this.threadListMeta = computed(() => { const { items: _ids, ...meta } = this.listSig.value; return meta; });
    this.pinnedThreadIds = this.pinnedThreadIdsSig;
    this.pinnedMore = this.pinnedMoreSig;
    this.pinnedError = this.pinnedErrorSig;
    this.activeThreadIds = this.activeThreadIdsSig;
    this.inboxThreadIds = this.inboxThreadIdsSig;
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
      if (this.canRead()) {
        void this.refresher.request("list");
        void this.refresher.request("archive");
        void this.refresher.request("active");
        if (this.capabilities.peek().includes(CAPABILITY_THREAD_TAGS)) void this.refresher.request("pinned");
      }
      else this.markListsStale();
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
    const next = normalizeFilter(this.filterSig.peek(), filter);
    this.filterSig.value = { ...next };
    this.listPages.cancel?.cancel();
    this.archivePages.cancel?.cancel();
    if (this.listRefs > 0 && this.canRead()) { void this.refresher.requestFresh("list"); void this.refresher.requestFresh("archive"); }
    if (this.capabilities.peek().includes(CAPABILITY_THREAD_TAGS)) void this.refresher.requestFresh("pinned");
  }

  refreshThreadList(): Promise<void> {
    return this.refresher.request("list");
  }

  /** Whether "show more" can do anything: more exist, and the bound isn't reached. */
  canLoadMoreThreads(): boolean {
    return canLoadMore(this.listPages);
  }

  loadMoreThreads(): Promise<void> {
    return this.loadMore(this.listPages);
  }

  canLoadMoreArchived(): boolean {
    return canLoadMore(this.archivePages);
  }

  loadMoreArchived(): Promise<void> {
    return this.loadMore(this.archivePages);
  }

  private async loadMore(pages: ListPages): Promise<void> {
    const cur = pages.state.value;
    const filter = cur.filter;
    if (!filter || !cur.nextCursor || cur.loadingMore || cur.loading || cur.items.length >= MAX_LIST_ROWS) return;
    const gen = pages.gen;
    pages.state.value = { ...cur, loadingMore: true };
    const out = await this.operations.threadList({ ...pages.args(filter), cursor: cur.nextCursor });
    if (gen !== pages.gen) return; // a refresh replaced the pages meanwhile
    const now = pages.state.value;
    pages.state.value = out.ok
      ? { ...now, items: [...new Set([...now.items, ...out.value.items.map(row => row.thread_id)])].slice(0, MAX_LIST_ROWS), nextCursor: out.value.next_cursor, loadingMore: false, error: undefined }
      : { ...now, loadingMore: false, error: out.error };
    if (out.ok) {
      this.threadRowsSig.value = rememberRows(this.threadRowsSig.peek(), out.value.items, this.heldRows());
    }
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
      if (this.canRead()) { this.requestThread(threadId); void this.refreshThreadRows([threadId], false); }
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
      definitions: e.definitions,
      observeDefinitions: () => {
        if (closed) return () => {};
        if (++e.definitionRefs === 1 && readable()) this.requestDefinitions(threadId);
        let observing = true;
        return () => {
          if (!observing) return;
          observing = false;
          if (--e.definitionRefs === 0) for (const rows of Object.values(e.definitions))
            rows.value = { ...rows.peek(), stale: true, loading: false };
        };
      },
      preview: e.preview,
      handoff: e.live.records,
      handoffOverflow: e.live.overflow,
      liveEpoch: () => e.live.epoch,
      liveEpochSignal: e.live.epochSignal,
      captureHandoffReplacement: () => e.live.captureReplacement(),
      commitHandoffReplacement: () => e.live.commitReplacement(),
      releaseAcceptedHandoff: attemptId => { if (!closed && !e.closed) e.live.releaseAccepted(attemptId); },
      historyTick: e.historyTick,
      readWindow: async (args, cancel) => {
        if (e.closed || e.paused) return Promise.resolve({ ok: false, error: { kind: "cancelled", message: "thread is not being read" } });
        if (!this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW)) return Promise.resolve({ ok: false, error: { kind: "invalid_response", message: "owner does not advertise history.window" } });
        const epoch = e.live.epoch;
        const readEpoch = this.readQualificationEpoch;
        const valid = () => !closed && !e.closed && !e.paused && !cancel.cancelled && epoch === e.live.epoch && readEpoch === this.readQualificationEpoch && this.canRead();
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
    if (this.listRefs > 0) {
      jobs.push(this.refresher.request("list"));
      jobs.push(this.refresher.request("archive"));
      jobs.push(this.refresher.request("active"));
      if (this.capabilities.peek().includes(CAPABILITY_THREAD_TAGS)) jobs.push(this.refresher.request("pinned"));
    }
    for (const id of this.entries.keys()) jobs.push(this.requestThread(id));
    // An open Thread's row is its own fact, read by ID whether or not a list page holds it.
    if (this.entries.size) jobs.push(this.refresher.request("open-rows"));
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
          this.launcher.value = null;
          this.startupStage.value = null;
          this.coreManagement.value = false;
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

  private invalidateDeletePreviews(): void {
    this.deletionHint.value = {};
  }

  private onFrame(f: Extract<LinkEvent, { kind: "frame" }>["frame"]): void {
    switch (f.t) {
      case "hello":
        this.invalidateDeletePreviews();
        this.desktopSig.value = f.desktop === true;
        this.coreManagement.value = f.core_management === true;
        this.bridgeVersionSig.value = f.bridge_version;
        this.dataDirSig.value = f.data_dir;
        this.listenSig.value = typeof f.listen === "string" ? f.listen : undefined;
        this.setOwner(f.owner);
        if (f.owner.state === "connected") { this.notifyHints(); void this.resyncAll(); }
        break;
      case "startup_stage":
        this.startupStage.value = f.stage;
        return;
      case "launcher_state":
        this.launcher.value = f.state;
        return;
      case "launcher_diagnostic":
        this.desktopDiagnosticSig.value = f.message;
        break;
      case "owner":
        this.invalidateDeletePreviews();
        batch(() => {
          this.setOwner(f.owner);
          if (f.event === "restarted") this.discardAllPreviews("owner_restarted");
        });
        if (f.event === "restarted") { this.notifyHints(); void this.resyncAll(); }
        break;
      case "resync":
        this.coreStatusHint.value++;
        this.invalidateDeletePreviews();
        this.configChanged.value++;
        this.listHint.value++;
        this.discardAllPreviews("resync");
        this.notifyHints();
        void this.resyncAll();
        break;
      case "changed":
        if (f.list || f.thread_ids.length) this.coreStatusHint.value++;
        if (f.thread_ids.length) this.deletionHint.value = { ids: f.thread_ids };
        // Hints are not data: re-read the saved facts. Untracked Threads are ignored.
        if (f.config_changed) this.configChanged.value++;
        if (f.list) {
          this.listHint.value++;
          if (this.listRefs > 0 && this.capabilities.peek().includes(CAPABILITY_THREAD_TAGS)) void this.refresher.request("pinned");
        }
        { const rows = f.list ? f.thread_ids : f.thread_ids.filter(id => this.entries.has(id));
          if (rows.length) void this.refreshThreadRows(rows, f.list); }
        for (const id of f.thread_ids) {
          for (const notify of this.hintWatchers.get(id) ?? []) notify();
          if (this.entries.has(id)) void this.requestThread(id);
        }
        break;
      case "live":
        { const entry=this.entries.get(f.thread_id);
          entry?.live.apply(f); }
        break;
      case "attempt_end":
        this.entries.get(f.thread_id)?.live.end(f.attempt_id, f.outcome, f.output_limit);
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
    if (previous.state === "connected" && owner.state === "connected" && previous.info.instance_id !== owner.info.instance_id) {
      this.discardAllPreviews("owner_restarted");
      this.threadRowsSig.value = new Map(); this.pinnedThreadIdsSig.value = []; this.pinnedMoreSig.value = false; this.pinnedErrorSig.value = undefined; this.activeThreadIdsSig.value = []; this.inboxThreadIdsSig.value = [];
    }
    this.ownerSig.value = owner;
    if (owner.state === "unreachable") {
      this.markAllStale();
      this.discardAllPreviews("owner_unreachable");
    }
  }

  /** Rows the cache must keep: open Threads and every ID a list, Archive or pinned state holds (each already bounded). */
  private heldRows(): Set<string> {
    return new Set([...this.entries.keys(), ...this.listSig.peek().items, ...this.archivePages.state.peek().items, ...this.pinnedThreadIdsSig.peek()]);
  }

  private markListsStale(): void {
    for (const { state } of [this.listPages, this.archivePages]) if (state.value.loaded) state.value = { ...state.value, stale: true };
  }

  private markAllStale(): void {
    this.markListsStale();
    for (const e of this.entries.values()) {
      const d = e.detail.value;
      if (d.value !== undefined) e.detail.value = { ...d, stale: true };
      for (const rows of Object.values(e.definitions)) rows.value = { ...rows.peek(), stale: true, loading: false };
      const w = e.work.value;
      if (w.value !== undefined) e.work.value = { ...w, stale: true };
    }
  }

  private discardAllPreviews(reason: PreviewDiscardReason): void {
    // Revoke every old read before any synchronous clear/discard observer can run.
    batch(() => {
      ++this.readQualificationEpoch;
      for (const e of this.entries.values()) {
        if (reason !== "resync") e.live.advanceEpoch();
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
    this.link.watch(watched, this.listRefs > 0 || this.coreStatusRefs > 0);
  }

  // ---- reads ----

  private canRead(): boolean {
    return this.link.connection.value === "open" && this.ownerSig.value.state === "connected";
  }

  private requestDefinitions(id: string): Promise<void>[] {
    return [this.refresher.request(`schedule:${id}`), this.refresher.request(`service:${id}`)];
  }

  private requestThread(id: string, history = true): Promise<void> {
    if (this.entries.get(id)?.paused) return Promise.resolve();
    const readWindow = history && this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW);
    return Promise.all([this.refresher.request(`thread:${id}`), ...(readWindow ? [this.refresher.request(`history:${id}`)] : []), ...(this.entries.get(id)?.workRefs ? [this.refresher.request(`work:${id}`)] : []), ...(this.entries.get(id)?.definitionRefs ? this.requestDefinitions(id) : [])]).then(
      () => undefined,
    );
  }

  private async read(key: string, onSent: () => void): Promise<void> {
    const epoch = this.readQualificationEpoch;
    await this.readKey(key, onSent);
    // A queued read revoked by an owner change or resync runs once more.
    if (epoch !== this.readQualificationEpoch && this.canRead()) void this.refresher.requestFresh(key);
  }

  private async readKey(key: string, onSent: () => void): Promise<void> {
    if (key === "inbox-rows") return this.readInboxRows();
    if (key === "open-rows") return this.refreshActiveRows([...this.entries.keys()], this.readQualificationEpoch);
    if (key === "pinned") return this.readPinned(onSent);
    if (key === "active") return this.readActive(onSent);
    if (key === "archive") return this.filterSig.value.awaiting ? undefined : this.readList(this.archivePages, onSent);
    if (key.startsWith("list")) return this.readList(this.listPages, onSent, key === "list-shape");
    const sep = key.indexOf(":");
    const kind = key.slice(0, sep);
    const entry = this.entries.get(key.slice(sep + 1));
    if (!entry) return; // closed since the request
    if (kind === "thread") return this.readDetail(entry, onSent);
    if (kind === "schedule" || kind === "service") {
      const epoch = this.readQualificationEpoch;
      const cancel = entry.cancel;
      const valid = () => entry.definitionRefs > 0 && !entry.closed && !entry.paused && !cancel.cancelled && entry.cancel === cancel && epoch === this.readQualificationEpoch && this.canRead();
      if (!valid()) return;
      const rows = entry.definitions[kind];
      rows.value = { ...rows.peek(), loading: true };
      const out = await this.operations.definitions(kind, entry.id, { onSent, cancel });
      if (valid()) rows.value = out.ok
        ? { value: out.value, loading: false, stale: false, error: undefined }
        : { ...rows.peek(), loading: false, stale: true, error: out.error };
      return;
    }
    if (kind === "work") return this.readWork(entry, onSent);
    if (kind !== "history" || !this.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW)) return;
    entry.historyTick.value++; // notification only; positional reads own history admission
  }

  private async readActive(onSent: () => void): Promise<void> {
    if (!this.canRead()) return;
    const epoch = this.readQualificationEpoch;
    const ids = new Set<string>(); let cursor: string | undefined; let pages = 0;
    do {
      const out = await this.operations.activeStatus(cursor, { onSent });
      if (!out.ok || epoch !== this.readQualificationEpoch) return;
      for (const item of out.value.items) if (item.kind === "run" && ["running", "waiting", "recovery_wait"].includes(item.state)) ids.add(item.thread_id);
      pages++;
      cursor = pages * ACTIVE_STATUS_PAGE_LIMIT < MAX_LIST_ROWS ? out.value.next_cursor : undefined;
      if (epoch !== this.readQualificationEpoch) return;
    } while (cursor);
    for (const state of ["failed", "recovery_wait"] as const) {
      let cursor: string | undefined;
      for (let page = 0; page * PAGE_LIMIT < MAX_LIST_ROWS; page++) {
        if (epoch !== this.readQualificationEpoch) return;
        const out = await this.operations.threadList({ state, archived: "include", limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) }, { onSent });
        if (!out.ok || epoch !== this.readQualificationEpoch) return;
        for (const row of out.value.items) if (ids.size < MAX_LIST_ROWS) ids.add(row.thread_id);
        cursor = out.value.next_cursor;
        if (!cursor || ids.size >= MAX_LIST_ROWS) break;
      }
    }
    if (epoch !== this.readQualificationEpoch) return;
    for (const id of this.activeThreadIdsSig.peek()) {
      const row = this.threadRowsSig.peek().get(id);
      if (ids.size < MAX_LIST_ROWS && row && isActiveSummary(row)) ids.add(id);
    }
    const nextIds = [...ids];
    const previousIds = this.activeThreadIdsSig.peek();
    if (!sameIds(nextIds, previousIds)) this.activeThreadIdsSig.value = nextIds;
    await this.refreshActiveRows(nextIds, epoch);
  }

  /** The Inbox contributes its currently displayed awaiting-human IDs to the same cache. */
  async readActiveRows(ids: readonly string[]): Promise<void> {
    const epoch = this.readQualificationEpoch;
    const unique = [...new Set(ids)].slice(0, MAX_LIST_ROWS);
    this.inboxThreadIdsSig.value = unique;
    if (this.canRead()) await this.refresher.requestFresh("inbox-rows");
    if (epoch !== this.readQualificationEpoch) return;
  }

  private async readInboxRows(): Promise<void> {
    const epoch = this.readQualificationEpoch;
    const ids = this.inboxThreadIdsSig.peek();
    await this.refreshActiveRows(ids, epoch);
  }

  private async refreshActiveRows(ids: readonly string[], epoch: number): Promise<void> {
    for (let i = 0; i < ids.length && i < MAX_LIST_ROWS; i += PAGE_LIMIT) {
      if (epoch !== this.readQualificationEpoch) return;
      await this.refreshThreadRows(ids.slice(i, i + PAGE_LIMIT), false);
      if (epoch !== this.readQualificationEpoch) return;
    }
  }

  /** Every pinned Thread, whatever its age: the `pin` tag filter walked page by page up to MAX_LIST_ROWS. */
  private async readPinned(onSent: () => void): Promise<void> {
    if (this.listRefs === 0 || !this.capabilities.peek().includes(CAPABILITY_THREAD_TAGS)) return;
    const epoch = this.readQualificationEpoch;
    const filter = this.filterSig.value;
    if (filter.awaiting) {
      this.pinnedErrorSig.value = undefined;
      return;
    }
    let rows: ThreadSummary[] = [];
    let cursor: string | undefined;
    do {
      // The pinned read keeps archived Threads only to feed the Archive band; the sidebar row filter hides them everywhere else.
      const out = await this.operations.threadList({ ...listArgs({ ...filter, archived: "include", tags: [...(filter.tags ?? []), "pin"] }), ...(cursor ? { cursor } : {}) }, { onSent });
      // A changed filter has already asked for a fresh read; keep the previous set until it lands.
      if (!out.ok) {
        if (epoch === this.readQualificationEpoch && this.listRefs > 0 && filter === this.filterSig.value) this.pinnedErrorSig.value = out.error;
        return;
      }
      if (epoch !== this.readQualificationEpoch || this.listRefs === 0 || filter !== this.filterSig.value) return;
      rows = mergeRows(rows, out.value.items);
      cursor = out.value.next_cursor;
    } while (cursor && rows.length < MAX_LIST_ROWS);
    batch(() => {
      const ids = rows.map(row => row.thread_id);
      if (!sameIds(ids, this.pinnedThreadIdsSig.peek())) this.pinnedThreadIdsSig.value = ids;
      this.pinnedErrorSig.value = undefined;
      this.pinnedMoreSig.value = cursor !== undefined;
      this.threadRowsSig.value = rememberRows(this.threadRowsSig.peek(), rows, this.heldRows());
    });
  }

  private async readList(target: ListPages, onSent: () => void, shapeOnly = false): Promise<void> {
    if (this.listRefs === 0) return;
    const gen = ++target.gen;
    const filter = this.filterSig.value;
    const epoch = this.readQualificationEpoch;
    const previous = target.state.value;
    const pages = shapeOnly || previous.filter !== filter ? 1 : Math.max(1, Math.ceil(previous.items.length / PAGE_LIMIT));
    target.state.value = { ...previous, loading: true, loadingMore: false };
    const cancel = target.cancel = new Cancel();
    let items: ThreadSummary[] = [];
    let cursor: string | undefined;
    // Rebuild the already loaded prefix from fresh cursors; do not publish an old tail as current.
    for (let page = 0; page < pages; page++) {
      const out = await this.operations.threadList({ ...target.args(filter), ...(cursor ? { cursor } : {}) }, { onSent, cancel });
      if (gen !== target.gen || filter !== this.filterSig.value || cancel.cancelled) return;
      if (epoch !== this.readQualificationEpoch) {
        target.state.value = { ...target.state.value, loading: false, stale: previous.loaded };
        return;
      }
      if (!out.ok) {
        target.state.value = { ...previous, loading: false, loadingMore: false, stale: previous.loaded, error: out.error };
        return;
      }
      items = mergeRows(items, out.value.items);
      cursor = out.value.next_cursor;
      if (!cursor || items.length >= MAX_LIST_ROWS) break;
    }
    const published = shapeOnly && previous.filter === filter ? mergeRows(items, previous.items.flatMap(id => { const row = this.threadRowsSig.peek().get(id); return row ? [row] : []; })) : items;
    target.state.value = { filter, items: published.map(row => row.thread_id), nextCursor: shapeOnly ? previous.nextCursor : cursor, loaded: true, loading: false, loadingMore: false, stale: false, error: undefined };
    this.threadRowsSig.value = rememberRows(this.threadRowsSig.peek(), items, this.heldRows());
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

  private async refreshThreadRows(ids: readonly string[], listChanged: boolean): Promise<void> {
    if (!ids.length || !this.canRead()) return;
    const epoch = this.readQualificationEpoch;
    const before = this.threadRowsSig.peek();
    const out = await this.operations.threadList({ thread_ids: [...new Set(ids)] });
    if (!out.ok || epoch !== this.readQualificationEpoch) return;
    const returned = new Map(out.value.items.map(row => [row.thread_id, row]));
    const activeStatus = new Set(this.activeThreadIdsSig.peek());
    for (const row of out.value.items) {
      if (isActiveSummary(row)) activeStatus.add(row.thread_id);
      else activeStatus.delete(row.thread_id);
    }
    for (const id of ids) if (!returned.has(id)) activeStatus.delete(id);
    const shapeChanged = ids.some(id => {
      const old = before.get(id); const current = returned.get(id);
      return !old || !current || old.parent_thread_id !== current.parent_thread_id;
    });
    const filter = this.listSig.peek().filter ?? {};
    const filterMembershipMayChange = ids.some(id => {
      const old = before.get(id); const current = returned.get(id);
      if (!old || !current) return false;
      return (filter.archived !== "include" && old.archived_at !== current.archived_at)
        || (!!filter.cwd && old.cwd !== current.cwd)
        || (!!filter.query && (old.title !== current.title || old.cwd !== current.cwd || old.excerpt !== current.excerpt))
        || (!!filter.awaiting && old.awaiting_named_count !== current.awaiting_named_count)
        || (!!filter.tags?.length && JSON.stringify(old.tags ?? []) !== JSON.stringify(current.tags ?? []));
    });
    // Archiving, unarchiving, a new parent or a changed filter field can move a Thread into or out of the Archive band.
    const archiveMayChange = shapeChanged || filterMembershipMayChange || ids.some(id => before.get(id)?.archived_at !== returned.get(id)?.archived_at);
    // Rows another read stored meanwhile stay: start from the current cache, not from `before`.
    const current = this.threadRowsSig.peek();
    // A hint that changed nothing keeps every identity, so nothing derived from the rows rebuilds.
    const rowsChanged = out.value.items.some(row => !sameRow(current.get(row.thread_id), row))
      || ids.some(id => !returned.has(id) && current.has(id));
    const active = [...activeStatus];
    const activeChanged = !sameIds(active, this.activeThreadIdsSig.peek());
    batch(() => {
      if (rowsChanged) {
        const next = new Map(current);
        for (const row of out.value.items) { next.delete(row.thread_id); next.set(row.thread_id, row); }
        for (const id of ids) if (!returned.has(id)) next.delete(id);
        this.threadRowsSig.value = trimRows(next, this.heldRows());
      }
      if (activeChanged) this.activeThreadIdsSig.value = active;
      for (const { state } of [this.listPages, this.archivePages]) {
        const list = state.peek();
        if (!list.loaded) continue;
        const items = list.items.filter(id => !ids.includes(id) || returned.has(id));
        if (items.length !== list.items.length) state.value = { ...list, items };
      }
    });
    if (listChanged && (shapeChanged || filterMembershipMayChange) && this.listRefs > 0) void this.refresher.requestFresh(shapeChanged ? "list-shape" : "list");
    if (listChanged && archiveMayChange && this.listRefs > 0) void this.refresher.requestFresh("archive");
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

function canLoadMore(pages: ListPages): boolean {
  const cur = pages.state.value;
  return cur.nextCursor !== undefined && cur.items.length < MAX_LIST_ROWS;
}

function listArgs(filter: ListFilter): ThreadListArgs {
  const constrained = filter.query !== undefined || !!filter.tags?.length || filter.cwd !== undefined || filter.awaiting !== undefined;
  return {
    ...(filter.query !== undefined ? { query: filter.query } : {}),
    ...(filter.archived !== undefined ? { archived: filter.archived } : {}),
    ...(filter.awaiting !== undefined ? { awaiting: filter.awaiting } : {}),
    ...(filter.tags !== undefined ? { tags: filter.tags } : {}),
    ...(filter.cwd !== undefined ? { cwd: filter.cwd } : {}),
    ...(!constrained ? { order: "created" as const } : {}),
    limit: PAGE_LIMIT,
  };
}

function defaultNewId(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) throw new Error("no crypto.randomUUID: pass newId");
  return c.randomUUID();
}
