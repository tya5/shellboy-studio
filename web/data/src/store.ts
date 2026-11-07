// The view-model: signals holding saved facts re-read through the proxy, never invented.
// Hints (`changed`, `resync`, `owner`) are triggers only; their payloads carry no data.
import { batch, computed, signal, type ReadonlySignal } from "@preact/signals-core";
import type { OpError } from "./errors";
import { Link, type ConnectionState, type LinkEvent } from "./link";
import {
  applyStream,
  discardPreview,
  NO_PREVIEW,
  type Preview,
  type PreviewDiscardReason,
} from "./live";
import { Operations } from "./operations";
import type {
  ArchivedFilter,
  HistoryItem,
  OwnerState,
  ThreadDetails,
  ThreadSummary,
} from "./protocol";
import { Refresher } from "./refresher";
import type { Transport } from "./transport";

/** Threads watched at once. Equals the bridge's per-tab bound; beyond it `openThread` throws. */
export const MAX_WATCHED_THREADS = 64;
/** Default page size for list reads (the owner's own maximum applies). */
export const PAGE_LIMIT = 50;
/** Page size of history reads. With HISTORY_EXCERPT_CHARS it keeps a page far below the 8 MiB frame. */
export const HISTORY_PAGE_LIMIT = 100;
/** Excerpt asked of `history.list`: the owner's maximum, so most messages need no `history.get`. */
export const HISTORY_EXCERPT_CHARS = 4096;
/** Newest history items kept per open Thread; `loadOlderHistory` doubles it up to the maximum. */
export const HISTORY_WINDOW = 400;
export const HISTORY_WINDOW_MAX = 6400;
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
  /** Oldest to newest, as the owner returns it; a window over the end of the path. */
  readonly history: ReadonlySignal<HistoryState>;
  readonly preview: ReadonlySignal<Preview>;
  refresh(): Promise<void>;
  loadOlderHistory(): Promise<void>;
}

export interface DataOptions {
  transport: Transport;
  /** UUID v4 source for operation ids. Defaults to `crypto.randomUUID`. */
  newId?: () => string;
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
  history = signal<HistoryState>({ items: [], earlierHidden: false, loaded: false, loading: false, loadingMore: false, stale: false, error: undefined });
  window = HISTORY_WINDOW;
  /** The next read starts from the beginning of the path, not from the last known item. */
  fullRead = true;
  preview = signal<Preview>(NO_PREVIEW);
  /** Bumped by every history read; a read started earlier drops its result. */
  historyGen = 0;
  constructor(readonly id: string) {}
}

export class ShellboyData {
  readonly link: Link;
  readonly operations: Operations;

  private readonly ownerSig = signal<OwnerView>({ state: "unknown" });
  private readonly bridgeVersionSig = signal<string | undefined>(undefined);
  private readonly invalidSig = signal<{ count: number; last: string | undefined }>({ count: 0, last: undefined });
  private readonly bridgeErrorSig = signal<{ code: string; message: string } | undefined>(undefined);
  private readonly listSig = signal<PagedState<ThreadSummary>>(emptyPaged());
  private readonly filterSig = signal<ListFilter>({});
  private listRefs = 0;
  private listGen = 0;
  private entries = new Map<string, ThreadEntry>();
  private watchQueued = false;
  private readonly refresher: Refresher;

  readonly connection: ReadonlySignal<ConnectionState>;
  readonly failedAttempts: ReadonlySignal<number>;
  readonly owner: ReadonlySignal<OwnerView>;
  /** Features the owner advertises (empty until protocol 3). Enable features from this. */
  readonly capabilities: ReadonlySignal<string[]>;
  readonly bridgeVersion: ReadonlySignal<string | undefined>;
  /** Undecodable frames seen (count and last reason); a bug indicator, not a user message. */
  readonly invalidFrames: ReadonlySignal<{ count: number; last: string | undefined }>;
  /** Last `error` frame from the bridge (e.g. an invalid watch). */
  readonly bridgeError: ReadonlySignal<{ code: string; message: string } | undefined>;
  readonly threadList: ReadonlySignal<PagedState<ThreadSummary>>;
  readonly listFilter: ReadonlySignal<ListFilter>;

  constructor(options: DataOptions) {
    this.link = new Link(options.transport);
    this.operations = new Operations(this.link, options.newId ?? defaultNewId);
    this.refresher = new Refresher((key, onSent) => this.read(key, onSent));
    this.connection = this.link.connection;
    this.failedAttempts = this.link.failedAttempts;
    this.owner = this.ownerSig;
    this.capabilities = computed(() => {
      const o = this.ownerSig.value;
      return o.state === "connected" ? o.info.capabilities : [];
    });
    this.bridgeVersion = this.bridgeVersionSig;
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

  setListFilter(filter: ListFilter): void {
    this.filterSig.value = { ...filter };
    if (this.listRefs > 0 && this.canRead()) void this.refresher.request("list");
  }

  refreshThreadList(): Promise<void> {
    return this.refresher.request("list");
  }

  async loadMoreThreads(): Promise<void> {
    const cur = this.listSig.value;
    if (!cur.nextCursor || cur.loadingMore || cur.loading) return;
    const gen = this.listGen;
    const filter = this.filterSig.value;
    this.listSig.value = { ...cur, loadingMore: true };
    const out = await this.operations.threadList({ ...listArgs(filter), cursor: cur.nextCursor });
    if (gen !== this.listGen) return; // a refresh replaced the pages meanwhile
    const now = this.listSig.value;
    this.listSig.value = out.ok
      ? { ...now, items: [...now.items, ...out.value.items], nextCursor: out.value.next_cursor, loadingMore: false, error: undefined }
      : { ...now, loadingMore: false, error: out.error };
  }

  /** Track one Thread (detail, history, live preview). Throws past MAX_WATCHED_THREADS. */
  openThread(threadId: string): ThreadHandle {
    let entry = this.entries.get(threadId);
    if (!entry) {
      if (this.entries.size >= MAX_WATCHED_THREADS)
        throw new RangeError(`at most ${MAX_WATCHED_THREADS} Threads can be open at once`);
      entry = new ThreadEntry(threadId);
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
    return {
      threadId,
      detail: e.detail,
      history: e.history,
      preview: e.preview,
      refresh: () => this.requestThread(threadId),
      loadOlderHistory: () => this.loadOlder(e),
      close: () => {
        if (closed) return;
        closed = true;
        if (--e.refs === 0) {
          e.closed = true;
          this.entries.delete(threadId);
          this.scheduleWatch();
        }
      },
    };
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
        this.setOwner(f.owner);
        if (f.owner.state === "connected") void this.resyncAll();
        break;
      case "owner":
        batch(() => {
          this.setOwner(f.owner);
          if (f.event === "restarted") this.discardAllPreviews("owner_restarted");
        });
        if (f.event === "restarted") void this.resyncAll();
        break;
      case "resync":
        this.discardAllPreviews("resync");
        void this.resyncAll();
        break;
      case "changed":
        // Hints are not data: re-read the saved facts. Untracked Threads are ignored.
        if (f.list && this.listRefs > 0) void this.refresher.request("list");
        for (const id of f.thread_ids) if (this.entries.has(id)) void this.requestThread(id);
        break;
      case "stream": {
        const entry = this.entries.get(f.thread_id);
        if (entry) entry.preview.value = applyStream(entry.preview.value, f);
        break;
      }
      case "error":
        this.bridgeErrorSig.value = { code: f.error.code, message: f.error.message };
        break;
    }
  }

  private setOwner(owner: OwnerState): void {
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
      const h = e.history.value;
      if (h.loaded) e.history.value = { ...h, stale: true };
    }
  }

  private markFullReads(): void {
    for (const e of this.entries.values()) e.fullRead = true;
  }

  private discardAllPreviews(reason: PreviewDiscardReason): void {
    for (const e of this.entries.values()) e.preview.value = discardPreview(reason);
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
    this.link.watch([...this.entries.keys()], this.listRefs > 0);
  }

  // ---- reads ----

  private canRead(): boolean {
    return this.link.connection.value === "open" && this.ownerSig.value.state === "connected";
  }

  private requestThread(id: string): Promise<void> {
    return Promise.all([this.refresher.request(`thread:${id}`), this.refresher.request(`history:${id}`)]).then(
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
    return this.readHistory(entry, onSent);
  }

  private async readList(onSent: () => void): Promise<void> {
    if (this.listRefs === 0) return;
    const gen = ++this.listGen;
    const filter = this.filterSig.value;
    this.listSig.value = { ...this.listSig.value, loading: true, loadingMore: false };
    const out = await this.operations.threadList(listArgs(filter), { onSent });
    if (gen !== this.listGen || filter !== this.filterSig.value) return; // superseded; a newer read follows
    const cur = this.listSig.value;
    this.listSig.value = out.ok
      ? { items: out.value.items, nextCursor: out.value.next_cursor, loaded: true, loading: false, loadingMore: false, stale: false, error: undefined }
      : { ...cur, loading: false, stale: cur.loaded, error: out.error };
  }

  private async readDetail(entry: ThreadEntry, onSent: () => void): Promise<void> {
    entry.detail.value = { ...entry.detail.value, loading: true };
    const out = await this.operations.threadGet(entry.id, { onSent });
    if (entry.closed) return;
    const cur = entry.detail.value;
    entry.detail.value = out.ok
      ? { value: out.value, loading: false, stale: false, error: undefined }
      : { ...cur, loading: false, stale: cur.value !== undefined, error: out.error };
  }

  private async readHistory(entry: ThreadEntry, onSent: () => void): Promise<void> {
    const gen = ++entry.historyGen;
    entry.history.value = { ...entry.history.value, loading: true };
    const out = await this.walkHistory(entry, gen, onSent);
    if (entry.closed || gen !== entry.historyGen) return;
    const cur = entry.history.value;
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
        first ? { onSent } : undefined,
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

function defaultNewId(): string {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) throw new Error("no crypto.randomUUID: pass newId");
  return c.randomUUID();
}
