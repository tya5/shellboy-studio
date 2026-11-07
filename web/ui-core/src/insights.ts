// Screen logic of Analytics, Resources and Settings: which owner reads run, and when. Reads run on
// opening a view or on request, never per render, and each has a stated bound.
import { batch, signal, type Signal } from "@preact/signals-core";
import type { ModelListResult, Operations, OpError, Outcome } from "../../data/src";
import {
  addCoverage,
  EMPTY_COVERAGE,
  mergeGroups,
  periodOf,
  readCompactionEvent,
  readGroup,
  type CompactionEvent,
  type Period,
  type PeriodDays,
  type UsageGroup,
  type WalkCoverage,
} from "./analytics";
import type { AnalyticsSection, SettingsSection } from "./route";
import { readIndex, readMemory, readReceipts, readStorage, readThreadSettings, type IndexFacts, type MemoryFacts, type ReceiptFacts, type StorageFacts, type ThreadSettings } from "./resources";

/**
 * Scan windows one walk reads before it stops and offers to continue. Each window is at most 10,000
 * model attempts plus 10,000 metadata rows on the owner, and the owner has no way to start at a date,
 * so a walk reads from the first attempt ever saved.
 */
export const MAX_WINDOWS = 64;
/** Groups one walk keeps. Days can't reach it; a by-Thread walk can, and then stops and says so. */
export const MAX_GROUPS = 2000;
/** The owner's largest group page. */
const GROUP_LIMIT = 168;
/** Rows of one Thread's `compact.list`. */
export const COMPACTION_ROWS = 50;

export type WalkStatus = "idle" | "loading" | "done" | "stopped" | "failed";

export interface WalkState {
  status: WalkStatus;
  groups: ReadonlyMap<string, UsageGroup>;
  coverage: WalkCoverage;
  /** Why it isn't complete. Values read so far stay shown. */
  error: OpError | undefined;
  /** More windows exist; `continue` reads them. */
  canContinue: boolean;
  /** Stopped at `MAX_GROUPS`, so some groups aren't counted. */
  capped?: boolean;
}

const emptyWalk: WalkState = { status: "idle", groups: new Map(), coverage: EMPTY_COVERAGE, error: undefined, canContinue: false };

/** Follows one grouped `usage.get` to its end: one call at a time, up to `MAX_WINDOWS`, then asks. */
export class UsageWalk {
  readonly state: Signal<WalkState> = signal(emptyWalk);
  private generation = 0;
  private cursor: string | undefined;

  constructor(
    private readonly ops: Operations,
    private readonly groupBy: "day" | "thread",
    private readonly period: () => Period,
  ) {}

  reset(): void {
    this.generation++;
    this.cursor = undefined;
    this.state.value = emptyWalk;
  }

  start(): Promise<void> {
    this.reset();
    return this.run();
  }

  /** Stops after the call on the wire. Values read so far stay. */
  stop(): void {
    this.generation++;
    const s = this.state.peek();
    if (s.status === "loading") this.state.value = { ...s, status: "stopped", canContinue: true };
  }

  /** Reads further windows from where the walk stopped. */
  continue(): Promise<void> {
    return this.state.peek().canContinue ? this.run() : Promise.resolve();
  }

  private async run(): Promise<void> {
    const generation = ++this.generation;
    const p = this.period();
    this.state.value = { ...this.state.peek(), status: "loading", error: undefined, canContinue: false };
    for (let read = 0; read < MAX_WINDOWS; read++) {
      const out = await this.ops.usageGet({ group_by: this.groupBy, timezone: p.zone, since: p.since, until: p.until, limit: GROUP_LIMIT, ...(this.cursor !== undefined && { cursor: this.cursor }) });
      if (generation !== this.generation) return;
      if (!out.ok) {
        // A cursor doesn't survive an owner restart: continuing can't help, only a new walk can.
        const expired = out.error.kind === "owner" && out.error.code === "cursor_expired";
        if (expired) this.cursor = undefined;
        this.state.value = { ...this.state.peek(), status: "failed", error: out.error, canContinue: !expired && this.state.peek().coverage.windows > 0 };
        return;
      }
      const page = out.value;
      const groups = new Map(this.state.peek().groups);
      for (const item of Array.isArray(page.items) ? page.items : []) {
        const g = readGroup(item);
        if (!g) continue;
        const had = groups.get(g.key);
        groups.set(g.key, had ? mergeGroups(had, g) : g);
      }
      const next = typeof page.next_cursor === "string" ? page.next_cursor : undefined;
      const more = page.more === true && next !== undefined;
      this.cursor = more ? next : undefined;
      const coverage = addCoverage(this.state.peek().coverage, page);
      if (groups.size >= MAX_GROUPS && more) {
        this.cursor = undefined;
        this.state.value = { status: "stopped", groups, coverage, error: undefined, canContinue: false, capped: true };
        return;
      }
      this.state.value = { status: more ? "loading" : "done", groups, coverage, error: undefined, canContinue: false };
      if (!more) return;
    }
    this.state.value = { ...this.state.peek(), status: "stopped", canContinue: true };
  }
}

export interface ReadState<T> {
  loading: boolean;
  value: T | undefined;
  error: OpError | undefined;
}

const nothing: ReadState<never> = { loading: false, value: undefined, error: undefined };

async function readInto<T>(target: Signal<ReadState<T>>, read: () => Promise<Outcome<Record<string, unknown>>>, parse: (v: Record<string, unknown>) => T): Promise<void> {
  target.value = { ...target.peek(), loading: true };
  const out = await read();
  // A failed read keeps the last value, marked with the error.
  target.value = out.ok ? { loading: false, value: parse(out.value), error: undefined } : { ...target.peek(), loading: false, error: out.error };
}

export interface CompactionState {
  threadId: string | undefined;
  loading: boolean;
  events: CompactionEvent[];
  /** The owner's source bound was reached: narrow the period to see older events. */
  limited: boolean;
  more: boolean;
  error: OpError | undefined;
}

export type ResourceRead = "memory" | "storage" | "index" | "receipts" | "bridge";

export interface BridgeMemory {
  rssBytes: number | undefined;
  reason: string | undefined;
}

const readBridgeMemory = (v: Record<string, unknown>): BridgeMemory => ({
  rssBytes: typeof v.rss_bytes === "number" ? v.rss_bytes : undefined,
  reason: typeof v.unavailable_reason === "string" ? v.unavailable_reason : undefined,
});

const lostConnection = (e: OpError | undefined): boolean => e?.kind === "not_connected" || e?.kind === "connection_lost";

export interface InsightsOptions {
  nowMs: () => number;
  /** Minutes east of UTC. */
  offsetMinutes: () => number;
}

export class Insights {
  readonly periodDays: Signal<PeriodDays> = signal(7);
  readonly period: Signal<Period>;
  readonly daily: UsageWalk;
  readonly byThread: UsageWalk;
  readonly compaction: Signal<CompactionState> = signal({ threadId: undefined, loading: false, events: [], limited: false, more: false, error: undefined });

  readonly memory: Signal<ReadState<MemoryFacts>> = signal(nothing);
  readonly storage: Signal<ReadState<StorageFacts>> = signal(nothing);
  readonly index: Signal<ReadState<IndexFacts>> = signal(nothing);
  readonly receipts: Signal<ReadState<ReceiptFacts | undefined>> = signal(nothing);
  readonly bridge: Signal<ReadState<BridgeMemory>> = signal(nothing);
  readonly thread: Signal<ReadState<ThreadSettings> & { threadId: string | undefined }> = signal({ ...nothing, threadId: undefined });
  /** Model catalog: an explicit request only, because it makes a network request. */
  readonly catalog: Signal<ReadState<ModelListResult>> = signal(nothing);

  private compactionGeneration = 0;
  private compactionPeriod: Period | undefined;
  private threadGeneration = 0;

  constructor(
    private readonly ops: Operations,
    private readonly options: InsightsOptions,
  ) {
    this.period = signal(this.computePeriod(7));
    this.daily = new UsageWalk(ops, "day", () => this.period.peek());
    this.byThread = new UsageWalk(ops, "thread", () => this.period.peek());
  }

  private computePeriod(days: PeriodDays): Period {
    return periodOf(days, this.options.nowMs(), this.options.offsetMinutes());
  }

  /** A section opened or the owner came back: reads what that section shows, once. */
  ensureAnalytics(section: AnalyticsSection, threadId: string | undefined): void {
    switch (section) {
      case "overview":
      case "tokens":
        this.ensureWalk(this.daily);
        return;
      case "compaction":
        this.ensureWalk(this.daily);
        this.ensureCompaction(threadId);
        return;
      case "threads":
        this.ensureWalk(this.byThread);
        return;
      case "storage":
        this.ensureRead("storage");
        this.ensureRead("receipts");
        return;
      case "memory":
        this.ensureRead("memory");
        this.ensureRead("bridge");
        return;
      case "index":
        this.ensureRead("index");
        return;
    }
  }

  private ensureWalk(walk: UsageWalk): void {
    const s = walk.state.peek();
    if (s.status === "idle" || (s.status === "failed" && lostConnection(s.error))) void walk.start();
  }

  private ensureCompaction(threadId: string | undefined): void {
    const s = this.compaction.peek();
    const id = s.threadId ?? threadId;
    if (id === undefined || s.loading) return;
    if (s.threadId === undefined || this.compactionPeriod !== this.period.peek() || lostConnection(s.error)) void this.showCompaction(id);
  }

  /** Walked data of the old period is dropped; the open section reads the new one. */
  setPeriod(days: PeriodDays): void {
    batch(() => {
      this.periodDays.value = days;
      this.renewPeriod();
    });
  }

  /** The period's facts, up to now. The open section reads again; other sections when opened. */
  refreshUsage(): void {
    batch(() => this.renewPeriod());
  }

  private renewPeriod(): void {
    this.daily.reset();
    this.byThread.reset();
    this.period.value = this.computePeriod(this.periodDays.peek());
  }

  /** One `compact.list` of one Thread, within the period. The owner has no list across Threads. */
  async showCompaction(threadId: string): Promise<void> {
    const generation = ++this.compactionGeneration;
    const p = this.period.peek();
    this.compactionPeriod = p;
    this.compaction.value = { ...this.compaction.peek(), threadId, loading: true, error: undefined };
    const out = await this.ops.compactList({ thread_id: threadId, since: p.since, until: p.until, limit: COMPACTION_ROWS });
    if (generation !== this.compactionGeneration) return;
    if (!out.ok) {
      this.compaction.value = { threadId, loading: false, events: [], limited: false, more: false, error: out.error };
      return;
    }
    const items = Array.isArray(out.value.items) ? out.value.items : [];
    const coverage = out.value.coverage as Record<string, unknown> | undefined;
    this.compaction.value = {
      threadId,
      loading: false,
      events: items.flatMap((i) => readCompactionEvent(i) ?? []),
      limited: coverage?.candidate_limit_reached === true,
      more: out.value.more === true,
      error: undefined,
    };
  }

  private ensureRead(kind: ResourceRead): void {
    const s = this.resource(kind).peek();
    if (!s.loading && s.value === undefined && (s.error === undefined || lostConnection(s.error))) this.refreshRead(kind);
  }

  private resource(kind: ResourceRead): Signal<ReadState<unknown>> {
    return { memory: this.memory, storage: this.storage, index: this.index, receipts: this.receipts, bridge: this.bridge }[kind] as Signal<ReadState<unknown>>;
  }

  /** One finite owner read, when a section opens and on request. There is no periodic sampling. */
  refreshRead(kind: ResourceRead): void {
    switch (kind) {
      case "memory":
        void readInto(this.memory, () => this.ops.memoryStatus(), readMemory);
        return;
      case "storage":
        void readInto(this.storage, () => this.ops.storageStatus(), readStorage);
        return;
      case "index":
        void readInto(this.index, () => this.ops.indexStatus(), readIndex);
        return;
      case "receipts":
        void readInto(this.receipts, () => this.ops.statusSummary(), readReceipts);
        return;
      case "bridge":
        void readInto(this.bridge, () => this.ops.bridgeMemory(), readBridgeMemory);
        return;
    }
  }

  /** A Settings section opened. `thread.get` doesn't open the Thread's history. */
  ensureSettings(section: SettingsSection, threadId: string | undefined): void {
    switch (section) {
      case "embeddings":
        this.ensureRead("index");
        return;
      case "storage":
        this.ensureRead("storage");
        this.ensureRead("memory");
        this.ensureRead("receipts");
        return;
      case "appearance":
        return;
      default:
        if (threadId !== undefined && this.thread.peek().threadId !== threadId) void this.readThread(threadId);
    }
  }

  async readThread(threadId: string): Promise<void> {
    const generation = ++this.threadGeneration;
    this.thread.value = { ...this.thread.peek(), threadId, loading: true };
    const out = await this.ops.threadGet(threadId);
    if (generation !== this.threadGeneration) return;
    this.thread.value = out.ok ? { threadId, loading: false, value: readThreadSettings(out.value), error: undefined } : { threadId, loading: false, value: undefined, error: out.error };
  }

  /** One GET to the connection's model list. Only ever from an explicit press. */
  async readCatalog(connection?: string): Promise<void> {
    this.catalog.value = { ...this.catalog.peek(), loading: true };
    const out = await this.ops.modelList(connection !== undefined ? { connection } : {});
    this.catalog.value = out.ok ? { loading: false, value: out.value, error: undefined } : { ...this.catalog.peek(), loading: false, error: out.error };
  }
}
