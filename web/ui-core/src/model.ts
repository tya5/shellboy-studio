// Screen logic over the data layer: which Thread is open, what the views show, the send, stop,
// retry and archive flows. Saved facts stay in the data layer; nothing here is optimistic.
import { computed, effect, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import type { Handle, Operations, OpError, ShellboyData, ShellEntry, ThreadDetails, ThreadHandle } from "../../data/src";
import { projectConversation, type ConversationRow, type StepRow } from "./conversation";
import { translator, type Lang, type Translate } from "./i18n";
import { Insights } from "./insights";
import { noPending, type PendingAdapter } from "./pending";
import { formatRoute, START_ROUTE, type Route, type ViewName } from "./route";
import { statusOfShell, type StatusKey } from "./status";
import { byUrgency, countByStatus, threadTree, type StatusCounts, type ThreadRow } from "./threads";
import { contextFacts, recoveryFacts, usageFacts, type ContextFacts, type RecoveryFacts, type UsageFacts } from "./usage";

export type ConnectionView = "connected" | "connecting" | "ownerDown" | "authNeeded";

export type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "failed"; message: string }
  | { kind: "unconfirmed"; operationId: string; text: string };

export interface OutputState {
  text: string;
  loading: boolean;
  /** More output exists than this view reads. */
  cutOff: boolean;
  error: string | undefined;
}

export interface BodyState {
  text: string | undefined;
  loading: boolean;
  error: string | undefined;
}

/** Failed connection attempts before suggesting that the token may be the problem. */
const AUTH_HINT_ATTEMPTS = 2;
/** `shell.list` page for one Thread; steps beyond it fall back to the state in history. */
const SHELL_LIST_LIMIT = 200;
/** Output and body caches keep this many entries, oldest dropped first. */
const CACHE_ENTRIES = 64;
/** One output or body read stops after this many pages (64 KiB each by the owner's default). */
const MAX_PAGES = 8;

export interface AppModelOptions {
  data: ShellboyData;
  pending?: PendingAdapter;
  lang?: Lang;
  /** Current time source for ages. */
  nowMs?: () => number;
  /** Minutes east of UTC, for calendar days in Analytics. */
  offsetMinutes?: () => number;
  /** Writes the route to wherever the location lives (the fragment in a browser). */
  onNavigate?: (hash: string) => void;
}

export function setBounded<V>(map: Map<string, V>, key: string, value: V): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  next.set(key, value);
  while (next.size > CACHE_ENTRIES) next.delete(next.keys().next().value as string);
  return next;
}

export const errorMessage = (e: OpError): string => e.message;

export class AppModel {
  readonly data: ShellboyData;
  readonly ops: Operations;
  readonly pending: PendingAdapter;
  readonly route: Signal<Route> = signal(START_ROUTE);
  /** Analytics, Resources and Settings reads. Nothing runs until one of those views opens. */
  readonly insights: Insights;
  readonly lang: Signal<Lang>;
  readonly now: Signal<number>;
  readonly t: ReadonlySignal<Translate>;

  readonly rows: ReadonlySignal<ThreadRow[]>;
  readonly counts: ReadonlySignal<StatusCounts>;
  readonly monitorFilter: Signal<StatusKey | undefined> = signal(undefined);
  readonly monitorRows: ReadonlySignal<ThreadRow[]>;
  readonly pendingCount: ReadonlySignal<number>;
  readonly connection: ReadonlySignal<ConnectionView>;

  /** The Thread the conversation shows: from the route, else the last one, else the newest. */
  readonly selectedId: ReadonlySignal<string | undefined>;
  readonly handle: Signal<ThreadHandle | undefined> = signal(undefined);
  readonly details: ReadonlySignal<ThreadDetails | undefined>;
  readonly selectedRow: ReadonlySignal<ThreadRow | undefined>;
  readonly conversation: ReadonlySignal<ConversationRow[]>;
  readonly context: ReadonlySignal<ContextFacts | undefined>;
  readonly usage: ReadonlySignal<UsageFacts | undefined>;
  readonly recovery: ReadonlySignal<RecoveryFacts | undefined>;
  readonly canStop: ReadonlySignal<boolean>;
  readonly canRetry: ReadonlySignal<boolean>;

  readonly shells: Signal<ReadonlyMap<string, ShellEntry>> = signal(new Map());
  readonly outputs: Signal<ReadonlyMap<string, OutputState>> = signal(new Map());
  readonly bodies: Signal<ReadonlyMap<string, BodyState>> = signal(new Map());
  readonly selectedStepId: Signal<string | undefined> = signal(undefined);
  readonly selectedStep: ReadonlySignal<StepRow | undefined>;
  readonly sendState: Signal<SendState> = signal({ kind: "idle" });
  readonly actionError: Signal<string | undefined> = signal(undefined);

  private readonly lastThread = signal<string | undefined>(undefined);
  private readonly watchedOutputs = new Map<string, string | undefined>();
  private readonly nowMs: () => number;
  private readonly onNavigate: ((hash: string) => void) | undefined;
  private listHandle: Handle | undefined;
  private disposers: (() => void)[] = [];
  private shellRead: { running: boolean; again: boolean } = { running: false, again: false };

  constructor(options: AppModelOptions) {
    this.data = options.data;
    this.ops = options.data.operations;
    this.pending = options.pending ?? noPending;
    this.lang = signal(options.lang ?? "en");
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.now = signal(this.nowMs());
    this.onNavigate = options.onNavigate;
    this.insights = new Insights(this.ops, {
      nowMs: this.nowMs,
      offsetMinutes: options.offsetMinutes ?? (() => -new Date(this.nowMs()).getTimezoneOffset()),
    });
    this.t = computed(() => translator(this.lang.value));

    const pendingByThread = computed(() => {
      const map = new Map<string, number>();
      for (const p of this.pending.items.value) map.set(p.threadId, (map.get(p.threadId) ?? 0) + 1);
      return map;
    });
    this.rows = computed(() => threadTree(this.data.threadList.value.items, pendingByThread.value));
    this.counts = computed(() => countByStatus(this.rows.value));
    this.pendingCount = computed(() => this.pending.items.value.length);
    this.monitorRows = computed(() => {
      const filter = this.monitorFilter.value;
      const rows = byUrgency(this.rows.value);
      return filter ? rows.filter((r) => r.status === filter) : rows;
    });
    this.connection = computed(() => {
      const conn = this.data.connection.value;
      if (conn !== "open") return this.data.failedAttempts.value >= AUTH_HINT_ATTEMPTS ? "authNeeded" : "connecting";
      const owner = this.data.owner.value;
      if (owner.state === "connected") return "connected";
      return owner.state === "unreachable" ? "ownerDown" : "connecting";
    });
    this.selectedId = computed(() => {
      const r = this.route.value;
      return r.threadId ?? this.lastThread.value ?? this.rows.value[0]?.summary.thread_id;
    });
    this.details = computed(() => this.handle.value?.detail.value.value);
    this.selectedRow = computed(() => {
      const id = this.selectedId.value;
      return this.rows.value.find((r) => r.summary.thread_id === id);
    });
    this.conversation = computed(() => {
      const h = this.handle.value;
      return h ? projectConversation(h.history.value.items, this.shells.value) : [];
    });
    this.context = computed(() => contextFacts(this.details.value));
    this.usage = computed(() => usageFacts(this.details.value));
    this.recovery = computed(() => (this.selectedRow.value?.status === "recovery" ? recoveryFacts(this.details.value) : undefined));
    this.canStop = computed(() => this.details.value?.run_id !== undefined);
    this.canRetry = computed(() => this.details.value?.run_id !== undefined && this.selectedRow.value?.status === "recovery");
    this.selectedStep = computed(() => {
      const id = this.selectedStepId.value;
      if (!id) return undefined;
      for (const row of this.conversation.value)
        if (row.type === "steps") for (const s of row.steps) if (s.executionId === id) return s;
      return undefined;
    });
  }

  start(): void {
    this.listHandle = this.data.trackThreadList();
    this.disposers.push(effect(() => this.syncOpenThread()));
    // Reads for a view run when it opens with the owner reachable, not when it renders.
    this.disposers.push(
      effect(() => {
        const view = this.route.value.view;
        if (this.connection.value !== "connected") return;
        const threadId = this.selectedId.value;
        if (view === "analytics") this.insights.ensureAnalytics(threadId);
        else if (view === "settings") this.insights.ensureSettings(threadId);
      }),
    );
    // Shell facts follow the hints: the store re-reads the Thread on each, and so do we.
    this.disposers.push(
      effect(() => {
        const h = this.handle.value;
        if (!h) return;
        h.detail.value;
        const history = h.history.value;
        if (history.items.some((i) => (i.executions?.length ?? 0) > 0)) void this.refreshShells(h.threadId);
      }),
    );
    this.data.start();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.listHandle?.close();
    this.listHandle = undefined;
    this.handle.value?.close();
    this.handle.value = undefined;
    this.data.stop();
  }

  /** A display tick for ages and elapsed time. Not a data read. */
  tick(): void {
    this.now.value = this.nowMs();
  }

  // ---- navigation ----

  /** The location changed from outside (a link, the back button). */
  applyRoute(route: Route): void {
    this.route.value = route;
  }

  navigate(route: Route): void {
    this.route.value = route;
    this.onNavigate?.(formatRoute(route));
  }

  showView(view: ViewName): void {
    if (view === "conversation") {
      const id = this.selectedId.value;
      this.navigate(id ? { view, threadId: id } : { view });
    } else this.navigate({ view });
  }

  openThread(threadId: string): void {
    this.navigate({ view: "conversation", threadId });
  }

  private syncOpenThread(): void {
    const id = this.selectedId.value;
    const view = this.route.value.view;
    const current = this.handle.peek();
    if (view !== "conversation" || id === undefined || current?.threadId === id) {
      if (id !== undefined && view === "conversation") this.lastThread.value = id;
      return;
    }
    current?.close();
    this.lastThread.value = id;
    this.shells.value = new Map();
    this.selectedStepId.value = undefined;
    this.watchedOutputs.clear();
    this.sendState.value = { kind: "idle" };
    this.actionError.value = undefined;
    this.handle.value = this.data.openThread(id);
  }

  // ---- reads on demand ----

  private async refreshShells(threadId: string): Promise<void> {
    if (this.shellRead.running) {
      this.shellRead.again = true;
      return;
    }
    this.shellRead.running = true;
    try {
      do {
        this.shellRead.again = false;
        const out = await this.ops.shellList({ thread_id: threadId, limit: SHELL_LIST_LIMIT });
        if (this.handle.peek()?.threadId !== threadId) return;
        // A failed read keeps the last facts; the step shows the state saved in history.
        if (out.ok) {
          this.shells.value = new Map(out.value.items.map((s) => [s.execution_id, s]));
          // Saved output changes only while a shell runs, and once more as it ends.
          for (const [id, lastState] of this.watchedOutputs) {
            const fact = this.shells.value.get(id);
            if (!fact || this.outputs.peek().get(id)?.loading) continue;
            if (fact.state !== lastState || statusOfShell(fact.state, fact.exit_code) === "running") {
              this.watchedOutputs.set(id, fact.state);
              void this.readOutput(id);
            }
          }
        }
      } while (this.shellRead.again);
    } finally {
      this.shellRead.running = false;
    }
  }

  /** A step was opened: read its output now and again when a hint shows it may have changed. */
  watchOutput(executionId: string): () => void {
    this.watchedOutputs.set(executionId, this.shells.peek().get(executionId)?.state);
    void this.readOutput(executionId);
    return () => this.watchedOutputs.delete(executionId);
  }

  private async readOutput(executionId: string): Promise<void> {
    const cur = this.outputs.peek().get(executionId);
    this.outputs.value = setBounded(this.outputs.peek() as Map<string, OutputState>, executionId, {
      text: cur?.text ?? "",
      loading: true,
      cutOff: false,
      error: undefined,
    });
    let text = "";
    let cursor: string | undefined;
    let error: string | undefined;
    let cutOff = false;
    for (let page = 0; ; page++) {
      if (page === MAX_PAGES) {
        cutOff = true;
        break;
      }
      const out = await this.ops.shellRead({ execution_id: executionId, ...(cursor !== undefined && { cursor }) });
      if (!out.ok) {
        error = errorMessage(out.error);
        break;
      }
      text += out.value.text;
      cursor = out.value.cursor;
      if (out.value.text === "" || cursor === undefined) break;
    }
    this.outputs.value = setBounded(this.outputs.peek() as Map<string, OutputState>, executionId, {
      text: error !== undefined ? (cur?.text ?? "") : text,
      loading: false,
      cutOff,
      error,
    });
  }

  /** Read one message beyond its excerpt. On request only. */
  async loadBody(nodeId: string): Promise<void> {
    const set = (b: BodyState) => {
      this.bodies.value = setBounded(this.bodies.peek() as Map<string, BodyState>, nodeId, b);
    };
    set({ text: undefined, loading: true, error: undefined });
    let text = "";
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const out = await this.ops.historyGet({ node_id: nodeId, ...(cursor !== undefined && { cursor }) });
      if (!out.ok) {
        set({ text: undefined, loading: false, error: errorMessage(out.error) });
        return;
      }
      text += out.value.text;
      cursor = out.value.next_cursor;
      if (cursor === undefined) break;
    }
    set({ text, loading: false, error: undefined });
  }

  // ---- actions (state changes arrive through hints and re-reads) ----

  async send(text: string): Promise<boolean> {
    const threadId = this.selectedId.value;
    if (threadId === undefined || text.trim() === "") return false;
    return this.deliver(threadId, text);
  }

  /** Repeat an unconfirmed send with the same operation id: the owner's receipt prevents a double. */
  async resend(): Promise<boolean> {
    const state = this.sendState.value;
    const threadId = this.selectedId.value;
    if (state.kind !== "unconfirmed" || threadId === undefined) return false;
    return this.deliver(threadId, state.text, state.operationId);
  }

  private async deliver(threadId: string, text: string, operationId?: string): Promise<boolean> {
    this.sendState.value = { kind: "sending" };
    const out = await this.ops.messageSend({ thread_id: threadId, text }, operationId);
    if (out.ok) {
      this.sendState.value = { kind: "idle" };
      return true;
    }
    this.sendState.value =
      out.error.kind === "unconfirmed"
        ? { kind: "unconfirmed", operationId: out.error.operationId, text }
        : { kind: "failed", message: errorMessage(out.error) };
    return false;
  }

  async stop(): Promise<void> {
    const runId = this.details.value?.run_id;
    if (runId === undefined) return;
    this.report("action.stop", await this.ops.runStop(runId));
  }

  /** Retry the open Thread, or any Thread: its Run is read first, the list doesn't carry it. */
  async retry(threadId?: string): Promise<void> {
    const id = threadId ?? this.selectedId.value;
    if (id === undefined) return;
    const details = await this.ops.threadGet(id);
    if (!details.ok) return this.report("action.retry", details);
    const runId = details.value.run_id;
    if (runId === undefined) return;
    this.report("action.retry", await this.ops.runRetry(runId));
  }

  async archive(threadId: string): Promise<void> {
    this.report("action.archive", await this.ops.threadArchive([threadId]));
  }

  async createThread(): Promise<void> {
    const cwd = this.details.value?.cwd;
    const out = await this.ops.threadCreate(cwd !== undefined ? { cwd } : {});
    this.report("action.new", out);
    if (out.ok) this.openThread(out.value.thread_id);
  }

  private report(action: "action.stop" | "action.retry" | "action.archive" | "action.new", out: { ok: true } | { ok: false; error: OpError }): void {
    this.actionError.value = out.ok
      ? undefined
      : this.t.value("action.failed", { action: this.t.value(action), message: errorMessage(out.error) });
  }
}
