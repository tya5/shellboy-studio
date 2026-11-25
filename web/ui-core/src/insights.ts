// Screen logic of Analytics, Resources and Settings: which owner reads run, and when. Reads run on
// opening a view or on request, never per render, and each has a stated bound.
import { batch, computed, effect, signal, type Signal } from "@preact/signals-core";
import { Cancel, lostConnection, memoryReadIssue, type MemoryFacts, type ModelListResult, type Operations, type OpError, type Outcome, type ReadOptions } from "../../data/src";
import {
  addCoverage,
  EMPTY_COVERAGE,
  mergeGroups,
  periodOf,
  rollingPeriod,
  readCompactionEvent,
  readGroup,
  type CompactionEvent,
  type Period,
  type PeriodDays,
  type UsageGroup,
  type WalkCoverage,
} from "./analytics";
import type { AnalyticsSection, SettingsSection } from "./route";
import { readIndex, readReceipts, readStorage, readThreadSettings, type IndexFacts, type ReceiptFacts, type StorageFacts, type ThreadSettings } from "./resources";

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
  private cancel = new Cancel();
  /** Stopped because nobody is looking, not by the person: reading continues on return. */
  private paused = false;

  constructor(
    private readonly ops: Operations,
    private readonly groupBy: "day" | "hour" | "thread" | "model",
    private readonly period: () => Pick<Period, "since" | "until" | "zone">,
    private readonly threadId?: string,
  ) {}

  reset(): void {
    this.generation++;
    this.cancel.cancel();
    this.paused = false;
    this.cursor = undefined;
    this.state.value = emptyWalk;
  }

  start(): Promise<void> {
    this.reset();
    return this.run();
  }

  /** Cancels the call on the wire. Values read so far stay. */
  stop(): void {
    this.generation++;
    this.cancel.cancel();
    const s = this.state.peek();
    if (s.status === "loading") this.state.value = { ...s, status: "stopped", canContinue: true };
  }

  /** Leaving what shows this: stop, keep what's read, and carry on from the same place on return. */
  pause(): void {
    if (this.state.peek().status !== "loading") return;
    this.stop();
    this.paused = true;
  }

  /** If the walk was paused, carries on. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.run();
  }

  /** Reads further windows from where the walk stopped. */
  continue(): Promise<void> {
    return this.state.peek().canContinue ? this.run() : Promise.resolve();
  }

  private async run(): Promise<void> {
    const generation = ++this.generation;
    this.cancel = new Cancel();
    const cancel = this.cancel;
    const p = this.period();
    this.state.value = { ...this.state.peek(), status: "loading", error: undefined, canContinue: false };
    for (let read = 0; read < MAX_WINDOWS; read++) {
      const out = await this.ops.usageGet({ group_by: this.groupBy, ...(this.threadId !== undefined && { thread_id: this.threadId }), timezone: p.zone, since: p.since, until: p.until, limit: GROUP_LIMIT, ...(this.cursor !== undefined && { cursor: this.cursor }) }, { cancel });
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
  ownerOperationId?: string;
}

const nothing: ReadState<never> = { loading: false, value: undefined, error: undefined };

/** The newest read of each value: a reply to an older one, cancelled or not, is dropped. */
const latestRead = new WeakMap<object, number>();

async function readInto<T, Wire>(target: Signal<ReadState<T>>, read: () => Promise<Outcome<Wire>>, parse: (v: Wire) => T): Promise<void> {
  const me = (latestRead.get(target) ?? 0) + 1;
  latestRead.set(target, me);
  target.value = { ...target.peek(), loading: true };
  const out = await read();
  if (latestRead.get(target) !== me || (!out.ok && out.error.kind === "cancelled")) return;
  // A failed read keeps the last value, marked with the error.
  target.value = out.ok ? { loading: false, value: parse(out.value), error: undefined } : { ...target.peek(), loading: false, error: out.error, ownerOperationId: out.ownerOperationId };
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


export interface InsightsOptions {
  nowMs: () => number;
  /** Minutes east of UTC. */
  offsetMinutes: () => number;
}

type RollingPeriod = ReturnType<typeof rollingPeriod>;

/** Independent previous-window cursor and cancellation, aligned to one captured current cut. */
export class RollingComparison {
  readonly enabled = signal(false);
  readonly interval = signal<RollingPeriod | undefined>(undefined);
  readonly walk: UsageWalk;

  constructor(ops: Operations) {
    this.walk = new UsageWalk(ops, "hour", () => this.interval.peek()!);
  }

  align(current: RollingPeriod | undefined): void {
    batch(() => {
      if (this.enabled.peek() && current) {
        this.interval.value = rollingPeriod(Date.parse(current.since), current.offsetMinutes);
        void this.walk.start();
      } else {
        this.walk.reset();
        this.interval.value = undefined;
      }
    });
  }
}

/** The visible rolling Overview owns one current walk and its last settled cut. */
export class RollingUsage {
  readonly enabled = signal(false);
  readonly interval = signal<RollingPeriod | undefined>(undefined);
  readonly walk: UsageWalk;
  readonly comparison: RollingComparison;
  private readonly accepted = signal<{ interval: RollingPeriod; walk: WalkState } | undefined>(undefined);
  private readonly selected = signal<string | undefined>(undefined);
  private scope: { owner: string; hint: number; scheduled: boolean } | undefined;

  readonly displayed = computed(() => {
    const active = this.walk.state.value;
    const retained = this.hasSettledCut(active) ? undefined : this.accepted.value;
    const interval = retained?.interval ?? this.interval.value;
    if (!interval) return undefined;
    const key = this.selected.value;
    const selection = interval.hours.find(hour => hour.key === key);
    const walk = retained?.walk ?? active;
    const partial = walk.status !== "done" || walk.coverage.scopeIncomplete === true || walk.coverage.excludedTime > 0;
    return { interval, walk, stale: retained !== undefined, selection, partial };
  });

  constructor(ops: Operations, private readonly options: InsightsOptions) {
    this.walk = new UsageWalk(ops, "hour", () => this.interval.peek()!);
    this.comparison = new RollingComparison(ops);
  }

  observe(owner: string | undefined, hint: number): void {
    if (owner !== this.scope?.owner) {
      this.leave();
      if (owner === undefined) return;
      this.scope = { owner, hint, scheduled: false };
      void this.start();
    } else if (this.scope && hint !== this.scope.hint) {
      const scope = this.scope;
      scope.hint = hint;
      if (scope.scheduled) return;
      scope.scheduled = true;
      // Close the obsolete generation now; coalesce only the replacement read.
      batch(() => {
        this.retainSettled();
        this.walk.reset();
        this.comparison.align(undefined);
      });
      queueMicrotask(() => {
        if (this.scope !== scope) return;
        scope.scheduled = false;
        void this.start();
      });
    }
  }

  leave(): void {
    this.scope = undefined;
    batch(() => {
      this.walk.reset();
      this.interval.value = undefined;
      this.accepted.value = undefined;
      this.comparison.align(undefined);
      this.selected.value = undefined;
    });
  }

  setComparison(enabled: boolean): void {
    if (this.comparison.enabled.peek() === enabled) return;
    batch(() => {
      this.comparison.enabled.value = enabled;
      this.comparison.align(this.scope?.scheduled ? undefined : this.interval.peek());
    });
  }

  retryComparison(): void {
    if (this.scope && !this.scope.scheduled) this.comparison.align(this.interval.peek());
  }

  retry(): void { if (this.scope && !this.scope.scheduled) void this.start(); }

  stop(): void {
    batch(() => {
      this.walk.stop();
      this.retainSettled();
    });
  }

  continue(): void {
    if (this.scope && !this.scope.scheduled) void this.finish(this.scope, this.walk.continue());
  }

  select(key: string): void {
    if (this.displayed.peek()?.interval.hours.some(h => h.key === key)) this.selected.value = key;
  }

  step(delta: -1 | 1): void {
    const cut = this.displayed.peek();
    if (!cut) return;
    const hours = cut.interval.hours;
    const index = cut.selection ? hours.indexOf(cut.selection) : delta > 0 ? -1 : 0;
    this.select(hours[(index + delta + hours.length) % hours.length]!.key);
  }

  private async start(): Promise<void> {
    const scope = this.scope!;
    const interval = rollingPeriod(this.options.nowMs(), this.options.offsetMinutes());
    const read = batch(() => {
      this.retainSettled();
      this.interval.value = interval;
      const read = this.walk.start();
      this.comparison.align(interval);
      return read;
    });
    await this.finish(scope, read);
  }

  private async finish(scope: NonNullable<RollingUsage["scope"]>, read: Promise<void>): Promise<void> {
    const interval = this.interval.peek();
    await read;
    if (this.scope !== scope || !interval || this.interval.peek() !== interval) return;
    this.retainSettled();
  }

  private hasSettledCut(walk: WalkState): boolean {
    // A completed empty read is a new fact; a stopped or failed read needs data to replace the display.
    return walk.status === "done" || ((walk.status === "stopped" || walk.status === "failed") && walk.groups.size > 0);
  }

  private retainSettled(): void {
    const interval = this.interval.peek();
    const walk = this.walk.state.peek();
    if (!interval || !this.hasSettledCut(walk)) return;
    batch(() => {
      if (!interval.hours.some(h => h.key === this.selected.peek())) this.selected.value = undefined;
      this.accepted.value = { interval, walk };
    });
  }
}

interface BucketDrilldown {
  key: string;
  since: string;
  until: string;
  zone: string;
  owner: string;
  hint: number;
  threadId?: string;
  walk: UsageWalk;
}

export class Insights {
  readonly periodDays: Signal<PeriodDays> = signal(7);
  readonly period: Signal<Period>;
  readonly daily: UsageWalk;
  readonly rolling: RollingUsage;
  readonly byThread: UsageWalk;
  /** One owner-keyed selected-bucket read; bucket heading and its walk publish as one value. */
  readonly bucketDrilldown: Signal<BucketDrilldown | undefined> = signal(undefined);
  private readonly drilldownOwner = signal<{ owner: string; hint: number } | undefined>(undefined);
  private readonly drilldownThread = signal<string | undefined>(undefined);
  private readonly disposeDrilldown: () => void;
  readonly compaction: Signal<CompactionState> = signal({ threadId: undefined, loading: false, events: [], limited: false, more: false, error: undefined });

  readonly memory: Signal<ReadState<MemoryFacts>> = signal(nothing);
  readonly storage: Signal<ReadState<StorageFacts>> = signal(nothing);
  readonly index: Signal<ReadState<IndexFacts>> = signal(nothing);
  readonly receipts: Signal<ReadState<ReceiptFacts | undefined>> = signal(nothing);
  readonly bridge: Signal<ReadState<BridgeMemory>> = signal(nothing);
  readonly thread: Signal<ReadState<ThreadSettings> & { threadId: string | undefined }> = signal({ ...nothing, threadId: undefined });
  /** Model catalog: an explicit request only, because it makes a network request. */
  readonly catalog: Signal<ReadState<ModelListResult>> = signal(nothing);

  private shown: string | undefined;
  private compactionGeneration = 0;
  private compactionCancel = new Cancel();
  /** Reads for whatever is showing. Replaced when it's cancelled. */
  private reads = new Cancel();
  private compactionPeriod: Period | undefined;
  private threadGeneration = 0;

  constructor(
    private readonly ops: Operations,
    private readonly options: InsightsOptions,
  ) {
    this.period = signal(this.computePeriod(7));
    this.rolling = new RollingUsage(ops, options);
    this.daily = new UsageWalk(ops, "day", () => this.period.peek());
    this.byThread = new UsageWalk(ops, "thread", () => this.period.peek());
    this.disposeDrilldown = effect(() => {
      const owner = this.drilldownOwner.value;
      const cut = this.rolling.displayed.value;
      const threadId = this.drilldownThread.value;
      const hour = cut?.selection;
      if (!owner || !cut || cut.stale || !hour) {
        this.clearBucketThreads();
        if (!hour) this.drilldownThread.value = undefined;
        return;
      }
      const since = new Date(hour.since).toISOString();
      const until = new Date(hour.until).toISOString();
      const zone = cut.interval.zone;
      const previous = this.bucketDrilldown.peek();
      if (previous?.key === hour.key && previous.since === since && previous.until === until &&
          previous.zone === zone && previous.owner === owner.owner && previous.hint === owner.hint &&
          previous.threadId === threadId) return;
      const walk = new UsageWalk(this.ops, threadId === undefined ? "thread" : "model", () => ({ since, until, zone }), threadId);
      batch(() => {
        this.clearBucketThreads();
        this.bucketDrilldown.value = { key: hour.key, since, until, zone, ...owner, threadId, walk };
        void walk.start();
      });
    });
  }

  private computePeriod(days: PeriodDays): Period {
    return periodOf(days, this.options.nowMs(), this.options.offsetMinutes());
  }

  /**
   * What's showing changed. Reads for anything no longer showing are cancelled, and walks carry on from
   * where they were when shown again. `undefined` means neither Analytics nor Settings is showing.
   */
  showing(section: string | undefined): void {
    if (section === this.shown) return;
    this.shown = section;
    if (section !== "rolling-overview") this.clearBucketThreads();
    if (section !== "overview" && section !== "tokens" && section !== "compaction") this.daily.pause();
    if (section !== "threads") this.byThread.pause();
    if (section !== "compaction") this.cancelCompaction();
    this.cancelReads();
  }

  private cancelReads(): void {
    this.reads.cancel();
    this.reads = new Cancel();
    this.threadGeneration++;
    if (this.thread.peek().loading) this.thread.value = { ...this.thread.peek(), threadId: undefined, loading: false };
    // Not loading any more: if the same thing is shown again it must read again.
    for (const target of [this.memory, this.storage, this.index, this.receipts, this.bridge] as Signal<ReadState<unknown>>[]) {
      if (target.peek().loading) target.value = { ...target.peek(), loading: false };
    }
  }

  private cancelCompaction(): void {
    if (!this.compaction.peek().loading) return;
    this.compactionGeneration++;
    this.compactionCancel.cancel();
    this.compactionPeriod = undefined;
    this.compaction.value = { ...this.compaction.peek(), loading: false };
  }

  /** A section opened or the owner came back: reads what that section shows, once. */
  ensureAnalytics(section: AnalyticsSection, threadId: string | undefined): void {
    this.showing(section);
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

  modelWalk(threadId: string, period: Period): UsageWalk {
    return new UsageWalk(this.ops, "model", () => period, threadId);
  }

  /** Synchronize owner identity and the same hint that invalidates the rolling walk. */
  observeRollingOwner(owner: string | undefined, hint: number, instance: string | undefined): void {
    batch(() => {
      this.rolling.observe(owner, hint);
      const previous = this.drilldownOwner.peek();
      if (previous?.owner !== instance || previous?.hint !== hint) {
        this.drilldownOwner.value = instance === undefined ? undefined : { owner: instance, hint };
      }
    });
  }

  selectBucketThreads(key: string): void {
    if (!this.rolling.displayed.peek()?.interval.hours.some(hour => hour.key === key)) return;
    batch(() => {
      if (this.rolling.displayed.peek()?.selection?.key !== key) this.drilldownThread.value = undefined;
      this.rolling.select(key);
    });
  }

  stepBucket(delta: -1 | 1): void {
    batch(() => {
      this.drilldownThread.value = undefined;
      this.rolling.step(delta);
    });
  }

  setBucketThread(threadId: string | undefined): void {
    const current = this.bucketDrilldown.peek();
    if (!current || (threadId !== undefined && !current.walk.state.peek().groups.has(threadId))) return;
    this.drilldownThread.value = threadId;
  }

  dispose(): void {
    this.disposeDrilldown();
    this.clearBucketThreads();
    this.rolling.leave();
  }

  private clearBucketThreads(): void {
    batch(() => {
      this.bucketDrilldown.peek()?.walk.reset();
      this.bucketDrilldown.value = undefined;
    });
  }

  private ensureWalk(walk: UsageWalk): void {
    walk.resume();
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
      this.rolling.enabled.value = false;
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
    this.clearBucketThreads();
    this.period.value = this.computePeriod(this.periodDays.peek());
  }

  /** One `compact.list` of one Thread, within the period. The owner has no list across Threads. */
  async showCompaction(threadId: string): Promise<void> {
    const generation = ++this.compactionGeneration;
    this.compactionCancel.cancel();
    const cancel = new Cancel();
    this.compactionCancel = cancel;
    const p = this.period.peek();
    this.compactionPeriod = p;
    this.compaction.value = { ...this.compaction.peek(), threadId, loading: true, error: undefined };
    const out = await this.ops.compactList({ thread_id: threadId, since: p.since, until: p.until, limit: COMPACTION_ROWS }, { cancel });
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
    const disconnected = kind === "memory" ? memoryReadIssue(s.error) === "disconnected" : lostConnection(s.error);
    if (!s.loading && s.value === undefined && (s.error === undefined || disconnected)) this.refreshRead(kind);
  }

  private resource(kind: ResourceRead): Signal<ReadState<unknown>> {
    return { memory: this.memory, storage: this.storage, index: this.index, receipts: this.receipts, bridge: this.bridge }[kind] as Signal<ReadState<unknown>>;
  }

  /** One finite owner read, when a section opens and on request. There is no periodic sampling. */
  refreshRead(kind: ResourceRead): void {
    const read: ReadOptions = { cancel: this.reads };
    switch (kind) {
      case "memory":
        void readInto(this.memory, () => this.ops.memoryStatus(read), value => value);
        return;
      case "storage":
        void readInto(this.storage, () => this.ops.storageStatus(read), readStorage);
        return;
      case "index":
        void readInto(this.index, () => this.ops.indexStatus(read), readIndex);
        return;
      case "receipts":
        void readInto(this.receipts, () => this.ops.statusSummary(read), readReceipts);
        return;
      case "bridge":
        void readInto(this.bridge, () => this.ops.bridgeMemory(read), readBridgeMemory);
        return;
    }
  }

  /** A Settings section opened. `thread.get` doesn't open the Thread's history. */
  ensureSettings(section: SettingsSection, threadId: string | undefined): void {
    this.showing(`settings:${section}`);
    switch (section) {
      case "index":
        this.ensureRead("index");
        return;
      case "storage":
        this.ensureRead("storage");
        this.ensureRead("memory");
        this.ensureRead("receipts");
        return;
      case "general":
        return;
      default:
        if (threadId !== undefined && this.thread.peek().threadId !== threadId) void this.readThread(threadId);
    }
  }

  async readThread(threadId: string): Promise<void> {
    const generation = ++this.threadGeneration;
    this.thread.value = { ...this.thread.peek(), threadId, loading: true };
    const out = await this.ops.threadGet(threadId, { cancel: this.reads });
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
