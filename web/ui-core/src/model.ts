// Screen logic over the data layer: which Thread is open, what the views show, the send, stop,
// retry and archive flows. Saved facts stay in the data layer; nothing here is optimistic.
import { computed, effect, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { Cancel, type Handle, type Operations, type OpError, type ShellboyData, type ShellEntry, type ThreadDetails, type ThreadHandle } from "../../data/src";
import { CAPABILITY_HISTORY_WINDOW } from "../../data/src";
import { ConversationWindow } from "./window";
import { branchRowMarks, projectConversation, type ConversationRow, type StepRow } from "./conversation";
import { translator, type Lang, type Translate } from "./i18n";
import { AppsModel } from "./apps";
import { branchMarks } from "./branches";
import { Branches, readWholeFamily, ThreadOrg } from "./branching";
import { CAPABILITY_CONFIG, ConfigEditor } from "./config";
import { Insights } from "./insights";
import { EmbeddingSetup } from "./embedding";
import { CAPABILITY_CONNECTION_SETUP, ConnectionSetup } from "./setup";
import { noPending, type PendingAdapter } from "./pending";
import { analyticsSection, formatRoute, settingsSection, START_ROUTE, type Route, type ViewName } from "./route";
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
const COARSE_TICK_MS = 30_000;
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
  readonly branches: Branches;
  readonly org: ThreadOrg;
  readonly config: ConfigEditor;
  readonly setup: ConnectionSetup;
  readonly embedding: EmbeddingSetup;
  readonly apps: AppsModel;
  /** Conversation: node id to branches leaving there, for the open Thread. Empty when it has no family. */
  readonly marks: Signal<ReadonlyMap<string, number>> = signal(new Map());
  /** Conversation row id to the mark it shows. */
  readonly rowMarks: ReadonlySignal<ReadonlyMap<string, { nodeId: string; branches: number }>>;
  readonly lang: Signal<Lang>;
  readonly now: Signal<number>;
  /** For ages in long lists: it moves every 30 s, so a list doesn't re-render all its rows per tick. */
  readonly coarseNow: Signal<number>;
  /** Thread rows by ID, built once per list change. */
  readonly rowById: ReadonlySignal<ReadonlyMap<string, ThreadRow>>;
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
  /** The long-thread reader, while the owner reads by position by position and the Conversation is open. */
  readonly longReader: Signal<ConversationWindow | undefined> = signal(undefined);
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
  private handlePaused = false;
  private readerThread: string | undefined;
  private readerTick = 0;
  private disposers: (() => void)[] = [];
  private shellRead: { running: boolean; again: boolean } = { running: false, again: false };
  /** Cancels reads for the open Thread (steps, bodies, marks) when another opens or the view is left. */
  private threadReads = new Cancel();
  /** A step's output read, cancelled when its row closes. */
  private outputReads = new Map<string, Cancel>();

  constructor(options: AppModelOptions) {
    this.data = options.data;
    this.ops = options.data.operations;
    this.pending = options.pending ?? noPending;
    this.lang = signal(options.lang ?? "en");
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.now = signal(this.nowMs());
    this.coarseNow = signal(this.now.peek());
    this.onNavigate = options.onNavigate;
    this.insights = new Insights(this.ops, {
      nowMs: this.nowMs,
      offsetMinutes: options.offsetMinutes ?? (() => -new Date(this.nowMs()).getTimezoneOffset()),
    });
    this.t = computed(() => translator(this.lang.value));
    this.branches = new Branches(this.ops);
    this.org = new ThreadOrg(this.ops, () => this.data.capabilities.peek());
    this.config = new ConfigEditor(this.ops);
    this.setup = new ConnectionSetup(this.ops);
    this.embedding = new EmbeddingSetup(this.ops, this.setup);
    this.apps = new AppsModel(this.ops);

    const pendingByThread = computed(() => {
      const map = new Map<string, number>();
      for (const p of this.pending.items.value) map.set(p.threadId, (map.get(p.threadId) ?? 0) + 1);
      return map;
    });
    this.rows = computed(() => threadTree(this.data.threadList.value.items, pendingByThread.value));
    this.rowById = computed(() => new Map(this.rows.value.map((r) => [r.summary.thread_id, r])));
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
      return id === undefined ? undefined : this.rowById.value.get(id);
    });
    this.conversation = computed(() => {
      const h = this.handle.value;
      return h ? projectConversation(h.history.value.items, this.shells.value) : [];
    });
    this.rowMarks = computed(() => {
      const w = this.longReader.value;
      if (!w) return branchRowMarks(this.handle.value?.history.value.items ?? [], this.conversation.value, this.marks.value);
      w.version.value; // marks follow the items the reader holds in view
      const items = w.rangeItems();
      return branchRowMarks(items, items.flatMap((i) => projectConversation([i], this.shells.value)), this.marks.value);
    });
    this.context = computed(() => contextFacts(this.details.value));
    this.usage = computed(() => usageFacts(this.details.value));
    this.recovery = computed(() => (this.selectedRow.value?.status === "recovery" ? recoveryFacts(this.details.value) : undefined));
    this.canStop = computed(() => this.details.value?.run_id !== undefined);
    this.canRetry = computed(() => this.details.value?.run_id !== undefined && this.selectedRow.value?.status === "recovery");
    this.selectedStep = computed(() => {
      const id = this.selectedStepId.value;
      if (!id) return undefined;
      const w = this.longReader.value;
      let rows = this.conversation.value;
      if (w) {
        w.version.value;
        rows = w.heldSteps().flatMap((i) => projectConversation([i], this.shells.value));
      }
      for (const row of rows)
        if (row.type === "steps") for (const s of row.steps) if (s.executionId === id) return s;
      return undefined;
    });
  }

  start(): void {
    let lastList: unknown;
    let marksFor: string | undefined;
    this.listHandle = this.data.trackThreadList();
    this.disposers.push(effect(() => this.syncOpenThread()));
    this.disposers.push(effect(() => this.syncWindow()));
    // A section's reads run when it opens with the owner reachable, not when it renders. A new
    // period re-runs this, so only the open section reads it.
    this.disposers.push(
      effect(() => {
        const route = this.route.value;
        this.insights.period.value;
        // Whatever is no longer showing stops being read.
        if (route.view !== "analytics" && route.view !== "settings") this.insights.showing(undefined);
        if (route.view !== "branches") this.branches.leave();
        if (route.view !== "threads") this.org.leave();
        if (route.view !== "settings") this.config.leave();
        if (route.view !== "setup") {
          this.setup.leave();
          this.embedding.leave();
        }
        if (this.connection.value !== "connected") return;
        const threadId = this.selectedId.value;
        if (route.view === "analytics") this.insights.ensureAnalytics(analyticsSection(route), threadId);
        else if (route.view === "settings") {
          this.insights.ensureSettings(settingsSection(route), threadId);
          if (settingsSection(route) !== "appearance" && this.data.capabilities.value.includes(CAPABILITY_CONFIG)) this.config.ensure();
        }
      }),
    );
    // Setup: with the capability, the file is read once per connection to the owner. If it has no
    // connection, the screen opens by itself, once, and only from the start of a session.
    this.disposers.push(
      effect(() => {
        if (this.connection.value !== "connected" || !this.data.capabilities.value.includes(CAPABILITY_CONNECTION_SETUP)) return;
        const probe = this.setup.probe.peek();
        if (probe.state === "idle") void this.setup.readFile();
        else if (this.route.value.view === "setup") this.setup.enter();
        if (this.setup.needed.value && this.route.peek().view === "conversation" && this.setup.takeAutoShow()) this.navigate({ view: "setup" });
      }),
    );
    // Apps read on opening the view. Open tabs stay open while other views show.
    this.disposers.push(
      effect(() => {
        const route = this.route.value;
        if (route.view !== "apps" || this.connection.value !== "connected") return;
        this.apps.ensure();
        if (route.appName !== undefined) void this.apps.open(route.appName);
      }),
    );
    // Both views follow the list: a list hint re-reads it, and each change here re-reads once.
    this.disposers.push(
      effect(() => {
        const view = this.route.value.view;
        // Items, not the whole state: its loading flags change without a new list.
        const list = this.data.threadList.value.items;
        if (this.connection.value !== "connected") return;
        const id = this.selectedId.value;
        if (view === "branches" && id !== undefined) {
          const b = this.branches.state.peek();
          if (b.threadId === id && b.family && lastList !== list) void this.branches.read(id);
          else this.branches.ensure(id);
        } else if (view === "threads") {
          if (this.org.loaded() && lastList !== list) void this.org.read();
          else this.org.ensure();
        }
        lastList = list;
      }),
    );
    this.disposers.push(
      effect(() => {
        const route = this.route.value;
        this.branches.state.value;
        if (route.view === "branches") this.branches.select(this.selectedId.value, route.nodeId);
      }),
    );
    // Marks need one family read per Thread opened, again when the list shows its children changed.
    // `children_count` from `thread.get` doesn't count forks, so it can't decide this.
    this.disposers.push(
      effect(() => {
        const h = this.handle.value;
        const childCount = this.selectedRow.value?.childCount ?? 0;
        if (h && marksFor !== undefined && !marksFor.startsWith(`${h.threadId}:`)) {
          marksFor = undefined;
          this.marks.value = new Map();
        }
        if (this.route.value.view !== "conversation" || !h || this.connection.value !== "connected") return;
        const stamp = `${h.threadId}:${childCount}`;
        if (stamp === marksFor) return;
        marksFor = stamp;
        void readWholeFamily(this.ops, h.threadId, this.threadReads).then((out) => {
          if (marksFor !== stamp) return;
          if (!out.ok && out.error.kind === "cancelled") {
            marksFor = undefined;
            return;
          }
          this.marks.value = out.ok ? branchMarks(out.family, h.threadId) : new Map();
        });
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
    this.longReader.peek()?.dispose();
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
    const now = this.nowMs();
    this.now.value = now;
    if (now - this.coarseNow.peek() >= COARSE_TICK_MS) this.coarseNow.value = now;
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

  /** One reader per open Thread while the Conversation shows and the owner has the positional read. */
  private syncWindow(): void {
    const h = this.handle.value;
    const want = this.route.value.view === "conversation" && h !== undefined && this.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW);
    const cur = this.longReader.peek();
    if (cur && (!want || this.readerThread !== h.threadId)) {
      cur.dispose(); // leaving the view or the Thread cancels its reads
      this.longReader.value = undefined;
      this.readerThread = undefined;
    }
    if (!want || !h) return;
    if (!this.longReader.peek()) {
      this.readerThread = h.threadId;
      this.readerTick = h.historyTick.peek();
      this.longReader.value = new ConversationWindow({ read: (a, c) => h.readWindow(a, c) });
    }
    const tick = h.historyTick.value; // a hint: the reader decides what to read
    if (tick !== this.readerTick) {
      this.readerTick = tick;
      this.longReader.peek()!.changed();
    }
    this.readerShells(this.longReader.peek()!);
  }

  /** Shell facts for the steps in view, read while it shows some. */
  private readerShells(w: ConversationWindow): void {
    w.version.value;
    const r = w.renderRange();
    if (!r || !this.handle.peek()) return;
    for (let i = r.first; i <= r.last; i++)
      if ((w.itemAt(i)?.executions?.length ?? 0) > 0) {
        void this.refreshShells(this.handle.peek()!.threadId);
        return;
      }
  }

  private cancelThreadReads(): void {
    this.threadReads.cancel();
    this.threadReads = new Cancel();
    this.shellRead = { running: false, again: false };
  }

  private syncOpenThread(): void {
    const id = this.selectedId.value;
    const view = this.route.value.view;
    const current = this.handle.peek();
    // Away from the Conversation, its Thread stops being read and keeps what it has.
    if (view !== "conversation") {
      if (current && !this.handlePaused) {
        this.handlePaused = true;
        current.pause();
        this.cancelThreadReads();
      }
      return;
    }
    if (current && this.handlePaused && (current.threadId === id || id === undefined)) {
      this.handlePaused = false;
      current.resume();
    }
    if (id === undefined || current?.threadId === id) {
      if (id !== undefined) this.lastThread.value = id;
      return;
    }
    this.handlePaused = false;
    this.cancelThreadReads();
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
        const out = await this.ops.shellList({ thread_id: threadId, limit: SHELL_LIST_LIMIT }, { cancel: this.threadReads });
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
    return () => {
      this.watchedOutputs.delete(executionId);
      this.outputReads.get(executionId)?.cancel();
      this.outputReads.delete(executionId);
    };
  }

  private async readOutput(executionId: string): Promise<void> {
    this.outputReads.get(executionId)?.cancel();
    const cancel = new Cancel();
    this.outputReads.set(executionId, cancel);
    const forget = this.threadReads.add(() => cancel.cancel());
    try {
      await this.readOutputPages(executionId, cancel);
    } finally {
      forget();
      if (this.outputReads.get(executionId) === cancel) this.outputReads.delete(executionId);
    }
  }

  private async readOutputPages(executionId: string, cancel: Cancel): Promise<void> {
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
      const out = await this.ops.shellRead({ execution_id: executionId, ...(cursor !== undefined && { cursor }) }, { cancel });
      if (!out.ok) {
        if (out.error.kind === "cancelled") {
          // Nobody is looking. Reopening the row reads again.
          const next = new Map(this.outputs.peek());
          next.delete(executionId);
          this.outputs.value = next;
          return;
        }
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
      const out = await this.ops.historyGet({ node_id: nodeId, ...(cursor !== undefined && { cursor }) }, { cancel: this.threadReads });
      if (!out.ok) {
        set({ text: undefined, loading: false, error: out.error.kind === "cancelled" ? undefined : errorMessage(out.error) });
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
