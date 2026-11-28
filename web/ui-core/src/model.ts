import { HistoryBodies, RetainedBodies, type BodyState } from "./history-bodies";
export type { BodyState } from "./history-bodies";
import { readThreadSettings } from "./resources";
import { readCompactionEvent, type CompactionEvent } from "./analytics";
import { seedUnreadMarkers, isUnread, markUnread, type UnreadRecord } from "./sidebar-unread";
import { AttachmentSection } from "./attachment-section";
import { captureConversationInput, createConversationIdentity, captureCurrentWork, EMPTY_WORK_SOURCE, type ConversationSemanticInput } from "./conversation-input";
import {localSendAdmission} from "./local-send-admission";
import { ownSendPresentation } from "./own-send-presentation";
import { SenderTitles } from "./sender-titles";
import { senderFact } from "../../data/src/sender";
import { BranchCompare } from "./branch-compare";
import { pairingHosts, issuePairing } from "../../data/src/pairing";
import { GuideRegistration } from "./guide-registration";
import { recentAppFolders } from "./app-templates";
// Screen logic over the data layer: which Thread is open, what the views show, the send, stop,
// retry and archive flows. Saved facts stay in the data layer; nothing here is optimistic.
import { batch, computed, effect, signal, untracked, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { Cancel, messageCancelFailure, type Handle, type Operations, type OpError, type ShellboyData, type ShellEntry, type StderrRange, type ThreadDetails, type ThreadSummary, type ThreadHandle, type ReplyCount } from "../../data/src";
import { ArtifactObservation, CAPABILITY_HISTORY_WINDOW, ReplyPages, type ReplySide } from "../../data/src";
import { workRegions, type WorkRegions } from "./work";
import { ConversationWindow, type WindowAcceptedSnapshot } from "./window";
import { projectHistoryWindowItems, projectSavedItems, projectOwnedHandoffFacts, normalizeLiveWorkFacts, scopeIssuedWorkFacts } from "./conversation-items";
import { branchRowMarks, collectExecutionSteps, materializeHistoryPresentation, type ConversationRow, type StepRow } from "./conversation";
import { translator, type Lang, type Translate } from "./i18n";
import { AppsModel } from "./apps";
import { branchMarks } from "./branches";
import { Branches, readWholeFamily, ThreadActions } from "./branching"
import { CAPABILITY_CONFIG, ConfigEditor } from "./config";
import { Insights } from "./insights";
import { EmbeddingSetup } from "./embedding";
import { CAPABILITY_CONNECTION_SETUP, ConnectionSetup } from "./setup";
import { type PendingAdapter } from "./pending";
import { HumanInbox } from "../../data/src";
import { analyticsSection, formatRoute, settingsSection, START_ROUTE, type Route, type ViewName } from "./route";
import { isThreadRecovery, statusOfShell } from "./status"
import { countByStatus, threadTree, type StatusCounts, type ThreadRow } from "./threads"
import { contextFacts, needsConnectionSetup, recoveryFacts, usageFacts, type ContextFacts, type RecoveryFacts, type UsageFacts } from "./usage";

interface ModelPickerSession {
  readonly route: Route;
  readonly owner: ShellboyData["owner"]["value"];
  readonly handle: ThreadHandle;
  readonly observation: NonNullable<ReturnType<ThreadHandle["captureDetail"]>>;
}

export type ConnectionView = "connected" | "connecting" | "ownerDown" | "authNeeded";

export type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "failed"; message: string; configuration?: boolean; diagnostic?: { code?: string; hint?: string; operationId?: string } }
  | { kind: "unconfirmed"; operationId: string; text: string };

export type RightPanelTab = "work" | "reply-needed" | "awaiting-reply" | "possessions" | "info" | "settings";
export type RightPanelTarget = Readonly<{ kind: "step" | "message" | "reply" | "attachment" | "artifact" | "schedule" | "service"; id: string; replySide?: ReplySide }>;
export type RightPanelDetail = RightPanelTarget & Readonly<{ opener?: () => boolean }>;
type PanelOperation = Readonly<{ kind: "cancel" | "answer" } & (
  { disposition: "pending"; source: "pending" | ReplySide; state: string } | { disposition: "failed" | "unconfirmed"; error: string }
)>;
type PanelFailure = { disposition: "failed" | "unconfirmed"; error: string };
type PanelPreference = Readonly<{ visible: () => boolean; collapsed: () => boolean; write: (collapsed: boolean) => void }>;

export interface PendingOwnMessage {
  readonly threadId: string;
  readonly scope: string;
  readonly operationId: string;
  readonly text: string;
  readonly phase: "sending" | "accepted" | "failed" | "unconfirmed";
  readonly messageId?: string;
  readonly heldAtAcceptance?: { hint?: string; operationId?: string };
  readonly plainMessageSend?: true;
  readonly clientOrdinal: number;
}

export interface OutputState {
  text: string;
  stderr?: readonly StderrRange[];
  loading: boolean;
  /** More output exists than this view reads. */
  cutOff: boolean;
  expired?: boolean;
  error: string | undefined;
}

/** Failed connection attempts before suggesting that the token may be the problem. */
const AUTH_HINT_ATTEMPTS = 2;
/** `shell.list` page for one Thread; steps beyond it fall back to the state in history. */
const SHELL_LIST_LIMIT = 200;
/** Shell output cache: oldest entries are dropped first. */
const CACHE_ENTRIES = 64;
const COARSE_TICK_MS = 30_000;
/** One output or body read stops after this many pages (64 KiB each by the owner's default). */
const MAX_PAGES = 8;

interface UnreadPreferences {
  read(): UnreadRecord[];
  write(records: UnreadRecord[]): void;
  visible(): boolean;
}

export interface AppModelOptions {
  unreadPreferences?: UnreadPreferences;
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

const assistantsByRows = new WeakMap<readonly import("../../data/src").HistoryItem[], import("../../data/src").HistoryItem | undefined>();
function latestAssistant(rows: readonly import("../../data/src").HistoryItem[]) {
  if (!assistantsByRows.has(rows)) {
    let candidate: import("../../data/src").HistoryItem | undefined;
    for (let i = rows.length - 1; i >= 0 && !candidate; i--) if (rows[i]?.kind === "assistant_response") candidate = rows[i];
    assistantsByRows.set(rows, candidate);
  }
  return assistantsByRows.get(rows);
}

export function setBounded<V>(map: Map<string, V>, key: string, value: V): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  next.set(key, value);
  while (next.size > CACHE_ENTRIES) next.delete(next.keys().next().value as string);
  return next;
}

export const errorMessage = (e: OpError): string => e.message;

export type ActionNotice = { kind: "error" | "success"; text: string };

export class AppModel {
  readonly pairing = signal<{ hosts: string[]; links: Record<string, { url: string; expires: number }>; error?: string }>({ hosts: [], links: {} });
  async loadPairingHosts(): Promise<void> {
    try { this.pairing.value = { ...this.pairing.peek(), hosts: await pairingHosts(), error: undefined }; }
    catch { this.pairing.value = { ...this.pairing.peek(), error: "pair.error" }; }
  }
  async createPairing(host: string): Promise<void> {
    try {
      const started = Date.now();
      const link = await issuePairing(host);
      const p = this.pairing.peek();
      this.pairing.value = { ...p, links: { ...p.links, [host]: { url: link.url, expires: started + link.expires_in_seconds * 1000 } }, error: undefined };
    } catch { this.pairing.value = { ...this.pairing.peek(), error: "pair.error" }; }
  }

  readonly threadSettings = computed(() => { const details = this.details.value; return details ? readThreadSettings(details) : undefined; });
  readonly pendingSettingFocus = signal<string | undefined>(undefined);
  readonly modelPicker = signal<{ open: boolean; thread: string; models: {connection: string; model: string}[]; catalogErrors: string[]; loading: boolean; saving: boolean; error?: string | undefined }>({ open: false, thread: "", models: [], catalogErrors: [], loading: false, saving: false });
  private modelListCancel = new Cancel();
  private readonly pickerSession = signal<ModelPickerSession | undefined>(undefined);
  private pickerCurrent(session: ModelPickerSession): boolean {
    const picker = this.modelPicker.peek();
    return this.pickerSession.peek() === session && picker.open && picker.thread === session.handle.threadId
      && this.route.peek() === session.route && session.route.view === "conversation"
      && this.selectedId.peek() === session.handle.threadId && this.handle.peek() === session.handle
      && this.data.owner.peek() === session.owner && this.data.connection.peek() === "open"
      && session.observation.isCurrent();
  }
  openModelPicker(): void {
    const route = this.route.peek();
    const handle = this.handle.peek();
    const owner = this.data.owner.peek();
    const observation = handle?.captureDetail();
    if (route.view !== "conversation" || !handle || !observation || owner.state !== "connected"
      || this.selectedId.peek() !== handle.threadId || observation.value.thread_id !== handle.threadId) {
      this.closeModelPicker();
      return;
    }
    const d = observation.value;
    const session: ModelPickerSession = { route, handle, owner, observation };
    batch(() => {
      this.closeModelPicker();
      this.pickerSession.value = session;
      this.modelPicker.value = { open: true, thread: d.thread_id, models: [], catalogErrors: [], loading: false, saving: false };
    });
    if (this.data.capabilities.peek().includes(CAPABILITY_CONFIG)) this.config.ensure();
  }
  closeModelPicker(): void {
    this.modelListCancel.cancel();
    batch(() => {
      this.pickerSession.value = undefined;
      this.modelPicker.value = { ...this.modelPicker.peek(), open: false, models: [], catalogErrors: [] };
    });
  }
  private loadPickerModels(session: ModelPickerSession, connections: string[]): () => void {
    const cancel = this.modelListCancel = new Cancel();
    const p = this.modelPicker.peek();
    this.modelPicker.value = { ...p, models: [], catalogErrors: [], loading: true };
    void Promise.all(connections.map(async connection => {
      const out = await this.ops.modelList({ thread_id: p.thread, connection }, { cancel });
      return out.ok ? { models: [...new Set(out.value.models)].sort().map(model => ({ connection, model })) }
        : { models: [], error: `${connection}: ${out.error.message}` };
    })).then(results => {
      if (cancel.cancelled || !this.pickerCurrent(session)) return;
      this.modelPicker.value = { ...this.modelPicker.peek(), loading: false,
        models: results.flatMap(result => result.models), catalogErrors: results.flatMap(result => result.error ? [result.error] : []) };
    });
    return () => cancel.cancel();
  }

  selectPickerModel(choice: { connection: string; model: string }): Promise<void> {
    if (!this.modelPicker.peek().models.some(row => row.connection === choice.connection && row.model === choice.model)) return Promise.resolve();
    return this.writePickerSettings({ connection: choice.connection, model: choice.model });
  }

  commitPickerModelId(id: string, filteredConnection?: string): Promise<void> {
    const model = id.trim();
    const connection = filteredConnection ?? this.details.peek()?.connection;
    if (!model || !connection) return Promise.resolve();
    return this.writePickerSettings({ connection, model });
  }

  selectPickerEffort(effort: string): Promise<void> {
    return this.writePickerSettings({ effort });
  }

  private async writePickerSettings(changes: Parameters<Operations["setThreadModel"]>[1]): Promise<void> {
    const session = this.pickerSession.peek();
    const p = this.modelPicker.peek();
    if (!session || !this.pickerCurrent(session) || !this.data.capabilities.peek().includes("thread.settings")
      || p.saving || Object.keys(changes).length === 0) return;
    this.modelPicker.value = { ...p, saving: true, error: undefined };
    const out = await this.ops.setThreadModel(p.thread, changes);
    if (!this.pickerCurrent(session)) return;
    this.modelPicker.value = { ...this.modelPicker.peek(), saving: false, error: out.ok ? undefined : out.error.message };
  }
  readonly coreActivityThread = signal<string>();
  readonly coreShutdownRefusal = signal<{ instance: string; message: string }>();
  readonly data: ShellboyData;
  readonly retainedBodies: RetainedBodies;
  readonly ops: Operations;
  readonly pending: PendingAdapter;
  readonly replyPages: ReplyPages;
  readonly route: Signal<Route> = signal(START_ROUTE);
  /** Analytics, Resources and Settings reads. Nothing runs until one of those views opens. */
  readonly insights: Insights;
  readonly branches: Branches;
  readonly threadActions: ThreadActions;
  readonly branchCompare: BranchCompare;
  readonly config: ConfigEditor;
  readonly guideRegistration: GuideRegistration;
  readonly setup: ConnectionSetup;
  readonly embedding: EmbeddingSetup;
  readonly apps: AppsModel;
  readonly appFolders: ReadonlySignal<string[]>;
  /** Conversation: node id to branches leaving there, for the open Thread. Empty when it has no family. */
  readonly marks: Signal<ReadonlyMap<string, number>> = signal(new Map());
  /** Conversation row id to the mark it shows. */
  readonly rowMarks: ReadonlySignal<ReadonlyMap<string, { nodeId: string; branches: number }>>;
  readonly lang: Signal<Lang>;
  readonly now: Signal<number>;
  readonly openToolGroups: Signal<ReadonlySet<string>> = signal(new Set());
  readonly toolStepChoices: Signal<ReadonlyMap<string, boolean>> = signal(new Map());
  /** For ages in long lists: it moves every 30 s, so a list doesn't re-render all its rows per tick. */
  readonly coarseNow: Signal<number>;
  /** Thread rows by ID, built once per list change. */
  readonly rowById: ReadonlySignal<ReadonlyMap<string, ThreadRow>>;
  readonly t: ReadonlySignal<Translate>;

  readonly rows: ReadonlySignal<ThreadRow[]>;
  readonly counts: ReadonlySignal<StatusCounts>;
  /** Retained awaiting-you questions; inexact while Core has more than the loaded pages. */
  readonly pendingCount: ReadonlySignal<ReplyCount>;
  readonly connection: ReadonlySignal<ConnectionView>;

  /** The Thread the conversation shows: from the route, else the last one, else the newest. */
  readonly selectedId: ReadonlySignal<string | undefined>;
  readonly handle: Signal<ThreadHandle | undefined> = signal(undefined);
  /** The long-thread reader, while the owner reads by position by position and the Conversation is open. */
  readonly longReader: Signal<ConversationWindow | undefined> = signal(undefined);
  get historySupported(): boolean { return this.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW); }
  readonly details: ReadonlySignal<ThreadDetails | undefined>;
  readonly selectedRow: ReadonlySignal<ThreadRow | undefined>;
  readonly conversation: ReadonlySignal<ConversationRow[]>;
  readonly context: ReadonlySignal<ContextFacts | undefined>;
  readonly recovery: ReadonlySignal<RecoveryFacts | undefined>;
  readonly canStop: ReadonlySignal<boolean>;
  readonly canRetry: ReadonlySignal<boolean>;
  readonly work: ReadonlySignal<WorkRegions>;

  readonly shells: Signal<ReadonlyMap<string, ShellEntry>> = signal(new Map());
  readonly outputs: Signal<ReadonlyMap<string, OutputState>> = signal(new Map());
  bodyState(nodeId: string, itemIdentity?: string): BodyState | undefined {
    return this.longReader.value?.bodies.get(nodeId, itemIdentity);
  }
  readonly attachmentSection: AttachmentSection;
  readonly artifacts: ArtifactObservation;
  readonly panelTab: Signal<RightPanelTab> = signal("work");
  readonly panelOpener: Signal<Partial<Record<RightPanelTab, RightPanelTarget>>> = signal({});
  private panelPreference?: PanelPreference;
  readonly panelOperations: Signal<ReadonlyMap<string, PanelOperation>> = signal(new Map());
  readonly panelDetail: Signal<RightPanelDetail | undefined> = signal(undefined);
  readonly selectedStepId: ReadonlySignal<string | undefined> = computed(() => this.panelDetail.value?.kind === "step" ? this.panelDetail.value.id : undefined);
  readonly selectedStep: ReadonlySignal<StepRow | undefined>;
  private nextTailOrdinal = () => 0;
  readonly pendingOwnMessage: Signal<PendingOwnMessage | undefined> = signal(undefined);
  readonly acceptedOwnMessages: Signal<readonly PendingOwnMessage[]> = signal([]);
  readonly ownSendCapacityReason: Signal<boolean> = signal(false);
  private ownSendCurrent: (() => boolean) | undefined;
  readonly sendState: Signal<SendState> = signal({ kind: "idle" });
  readonly actionError: Signal<ActionNotice | undefined> = signal(undefined);
  readonly appRequestState: Signal<{ kind: "idle" | "sending" | "failed" | "unconfirmed"; message?: string }> = signal({ kind: "idle" });

  private readonly lastThread = signal<string | undefined>(undefined);
  private readonly watchedOutputs = new Map<string, { count: number; state: string | undefined }>();
  private readonly nowMs: () => number;
  private readonly onNavigate: ((hash: string) => void) | undefined;
  private listHandle: Handle | undefined;
  private handlePaused = false;
  private readerThread: string | undefined;
  private readerTick = 0;
  private shellScan?: { reader: ConversationWindow; rows: WindowAcceptedSnapshot['rows']; tick: number };
  private disposers: (() => void)[] = [];
  private shellRead: { running: boolean; again: boolean } = { running: false, again: false };
  /** Cancels reads for the open Thread (steps, bodies, marks) when another opens or the view is left. */
  private threadReads = new Cancel();
  /** A step's output read, cancelled when its row closes. */
  private outputReads = new Map<string, Cancel>();
  private autoBodyReads = new WeakMap<ThreadHandle, WeakMap<ConversationWindow, string>>();


  readonly senderTitles: SenderTitles;
  private readonly senderPage = signal(0);
  senderPageSelected(): void { this.senderPage.value++; }
  senderPageAfter(read: () => Promise<void>): void {
    const owner = this.data.owner.peek();
    const route = this.route.peek();
    const handle = this.handle.peek();
    void read().then(() => {
      if (this.data.owner.peek() === owner && this.route.peek() === route && this.handle.peek() === handle && route.view === "conversation") this.senderPageSelected();
    });
  }

  private readonly unreadPreferences: UnreadPreferences | undefined;
  private readonly unreadMarkers = computed(() => new Map(
    (this.unreadPreferences?.read() ?? []).map(record => [record.thread, record]),
  ));

  sidebarUnread(row: ThreadSummary): boolean {
    return isUnread(this.unreadMarkers.value.get(row.thread_id), row.last_end_message);
  }

  markSidebarUnread(thread: string, manual: boolean): void {
    const row = this.data.threadList.peek().items.find(item => item.thread_id === thread);
    if (row?.last_end_message?.node_id) this.recordSidebarRead(thread, row.last_end_message, manual);
  }

  private recordSidebarRead(thread: string, end: ThreadSummary["last_end_message"], manual = false): void {
    const prefs = this.unreadPreferences;
    if (!prefs) return;
    const old = prefs.read();
    const next = markUnread(old, thread, end, manual);
    if (next !== old) prefs.write(next);
  }

  private trackSidebarRead(): void {
    const prefs = this.unreadPreferences;
    if (!prefs) return;
    this.disposers.push(effect(() => {
      const list = this.data.threadList.value;
      if (!list.loaded || list.loading || list.stale) return;
      // Seed only on list observations; eviction itself must not trigger another write.
      untracked(() => {
        const old = prefs.read();
        const next = seedUnreadMarkers(old, list.items);
        if (next !== old) prefs.write(next);
      });
    }));
    let opened: string | undefined;
    let lastNode: string | null | undefined;
    this.disposers.push(effect(() => {
      const id = this.route.value.view === "conversation" ? this.selectedId.value : undefined;
      if (opened !== id) { opened = id; lastNode = undefined; }
      const handle = this.handle.value;
      if (!id || handle?.threadId !== id) return;
      handle.detail.value;
      const detail = handle.captureDetail()?.value;
      if (detail?.thread_id !== id) return;
      const node = detail.last_end_message?.node_id ?? null;
      const first = lastNode === undefined;
      if (node === lastNode) return;
      lastNode = node;
      if (first || this.unreadPreferences?.visible()) {
        untracked(() => this.recordSidebarRead(id, detail.last_end_message));
      }
    }));
  }

  constructor(options: AppModelOptions) {
    this.unreadPreferences = options.unreadPreferences;
    this.data = options.data;
    this.retainedBodies = new RetainedBodies(this.data.retainedBudget);
    this.disposers.push(() => this.retainedBodies.clear());
    let bodyOwner: string | undefined;
    this.disposers.push(effect(() => {
      const owner = this.data.owner.value;
      const instance = owner.state === "connected" ? owner.info.instance_id ?? undefined : undefined;
      if (instance !== bodyOwner) { bodyOwner = instance; this.retainedBodies.clear(); }
    }));
    this.attachmentSection = new AttachmentSection(this.data);
    this.artifacts = new ArtifactObservation(this.data);
    this.ops = options.data.operations;
    this.pending = options.pending ?? new HumanInbox(options.data);
    this.replyPages = new ReplyPages(this.data);
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
    this.branches = new Branches(this.ops, () => { const owner = this.data.owner.peek(); return owner.state === "connected" ? owner.info.instance_id ?? undefined : undefined; }, () => this.selectedId.peek(), () => this.data.capabilities.peek().includes(CAPABILITY_HISTORY_WINDOW));
    this.threadActions = new ThreadActions(this.ops);
    this.disposers.push(effect(() => {
      const owner = this.data.owner.value;
      this.branches.ownerChanged(owner.state === "connected" ? owner.info.instance_id ?? undefined : undefined);
    }));
    this.branchCompare = new BranchCompare(this.ops);
    this.disposers.push(effect(() => {
      const owner = this.data.owner.value;
      const route = this.route.value;
      const connected = owner.state === "connected";
      const id = connected ? owner.info.instance_id : undefined;
      // Choosing a message (route nodeId) keeps the comparison; another Thread or owner starts over.
      this.branchCompare.context(JSON.stringify([id, route.view, route.threadId]), connected && this.data.connection.value === "open" && !!id && route.view === "branches" && this.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW));
    }));
    this.senderTitles = new SenderTitles(this.ops);
    this.config = new ConfigEditor(this.ops);
    this.ops.onConfigWrite = fields => this.config.trackConfigWrite(fields);
    this.disposers.push(() => { this.ops.onConfigWrite = undefined; });
    this.disposers.push(effect(() => {
      const owner = this.data.owner.value;
      const instance = owner.state === "connected" ? owner.info.instance_id : undefined;
      if (instance) this.config.observeInstance(instance);
    }));
    const pickerConnections = computed(() => {
      const session = this.pickerSession.value;
      if (!session) return "";
      const config = this.config.read.value.value?.loaded.values?.connections;
      return JSON.stringify([...new Set([session.observation.value.connection,
        ...Object.keys(config && typeof config === "object" ? config : {})])].filter(Boolean).sort());
    });
    this.disposers.push(effect(() => {
      const session = this.pickerSession.value;
      const connections = pickerConnections.value;
      if (session && connections) return untracked(() => this.loadPickerModels(session, JSON.parse(connections) as string[]));
    }));
    this.disposers.push(effect(() => {
      if (this.data.configChanged.value > 0 && this.data.capabilities.peek().includes(CAPABILITY_CONFIG)) {
        untracked(() => void this.config.configChanged());
      }
    }));
    this.guideRegistration = new GuideRegistration(this.ops);
    this.setup = new ConnectionSetup(this.ops);
    this.embedding = new EmbeddingSetup(this.ops, this.setup);
    this.apps = new AppsModel(this.ops);
    this.appFolders = computed(() => recentAppFolders(this.apps.folders.value.names, this.data.threadList.value.items.map((item) => item.cwd)));

    const pendingByThread = computed(() => {
      const map = new Map<string, number>();
      for (const p of this.pending.items.value) map.set(p.threadId, (map.get(p.threadId) ?? 0) + 1);
      return map;
    });
    this.rows = computed(() => {
      const exact = this.data.threadRows.value;
      const ids = new Set([...this.data.listThreadIds.value, ...this.data.pinnedThreadIds.value, ...this.data.activeThreadIds.value, ...this.data.inboxThreadIds.value]);
      const rows = [...ids].flatMap(id => { const row = exact.get(id); return row ? [row] : []; });
      return threadTree(rows, pendingByThread.value);
    });
    this.rowById = computed(() => {
      const rows = new Map(this.rows.value.map(row => [row.summary.thread_id, row]));
      const exact = this.data.threadRows.value;
      for (const [id, summary] of exact) if (!rows.has(id)) rows.set(id, threadTree([summary], pendingByThread.value)[0]!);
      return rows;
    });
    this.counts = computed(() => countByStatus(this.rows.value));
    this.pendingCount = computed(() => ({ count: this.pending.items.value.length, exact: this.pending.complete?.value ?? !this.pending.hasMore?.value }));
    this.connection = computed(() => {
      const conn = this.data.connection.value;
      if (conn !== "open") return this.data.failedAttempts.value >= AUTH_HINT_ATTEMPTS ? "authNeeded" : "connecting";
      const owner = this.data.owner.value;
      if (owner.state === "connected") return "connected";
      return owner.state === "unreachable" ? "ownerDown" : "connecting";
    });
    this.disposers.push(effect(() => {
      const settingsShown = this.route.value.view === "settings" || (this.route.value.view === "setup" && this.route.value.step === "share");
      if (!settingsShown && !this.modelPicker.value.open) untracked(() => this.config.leave());
      else if (this.connection.value === "connected" && this.data.capabilities.value.includes(CAPABILITY_CONFIG)) {
        untracked(() => this.config.ensure());
      }
    }));
    this.selectedId = computed(() => {
      const r = this.route.value;
      return r.threadId ?? this.lastThread.value ?? this.rows.value[0]?.summary.thread_id;
    });
    this.details = computed(() => this.handle.value?.detail.value.value);
    this.work = computed(() => workRegions(this.handle.value?.work.value.value, this.details.value?.run_id, this.shells.value));
    this.selectedRow = computed(() => {
      const id = this.selectedId.value;
      return id === undefined ? undefined : this.rowById.value.get(id);
    });
    this.conversation = computed(() => {
      const historyWindow = this.longReader.value;
      return historyWindow ? materializeHistoryPresentation(historyWindow.rangeItems(), this.shells.value, historyWindow.acceptedView.peek().revision ?? 0).rows : [];
    });
    this.rowMarks = computed(() => {
      const w = this.longReader.value;
      if (!w) return branchRowMarks([], [], this.marks.value);
      w.version.value; // marks follow the items the reader holds in view
      const items = w.rangeItems();
      return branchRowMarks(items, materializeHistoryPresentation(items, this.shells.value, w.acceptedView.peek().revision ?? 0).rows, this.marks.value);
    });
    this.context = computed(() => contextFacts(this.details.value));
    // The open Thread's own facts: its row-cache activity (read by ID, in the list or not) and thread.get.
    // The merged attention mark is not consulted: an open question must not hide recovery.
    this.recovery = computed(() => (isThreadRecovery(this.selectedRow.value?.summary.activity) ? recoveryFacts(this.details.value) : undefined));
    this.canStop = computed(() => this.details.value?.run_id !== undefined);
    this.canRetry = computed(() => this.details.value?.run_id !== undefined && isThreadRecovery(this.selectedRow.value?.summary.activity));
    this.selectedStep = computed(() => {
      const id = this.selectedStepId.value;
      if (!id) return undefined;
      const w = this.longReader.value;
      if (w) w.version.value;
      const steps = collectExecutionSteps(w?.heldSteps() ?? [], this.shells.value);
      return steps.find(step => step.executionId === id);
    });
  }

  start(): void {
    let lastList: unknown;
    let marksFor: string | undefined;
    this.listHandle = this.data.trackThreadList();
    this.disposers.push(effect(() => this.syncOpenThread()));
    this.trackSidebarRead();
    const replyThread = computed(() => this.route.value.view === "conversation" && this.details.value?.pending_replies
      ? this.details.value.thread_id : undefined);
    this.disposers.push(effect(() => {
      const thread = replyThread.value;
      const owner = this.data.owner.value;
      if (this.data.connection.value === "open" && thread && owner.state === "connected")
        return this.replyPages.observe(thread);
    }));
    this.disposers.push(effect(() => this.settlePanelOperations()));
    this.disposers.push(effect(() => this.syncWindow()));
    this.disposers.push(effect(() => {
      const session = this.pickerSession.value;
      this.route.value; this.handle.value; this.data.owner.value; this.data.connection.value;
      if (session) {
        session.handle.detail.value;
        if (!this.pickerCurrent(session)) this.closeModelPicker();
      }
    }));
    this.disposers.push(effect(() => {
      this.route.value; this.handle.value; this.data.owner.value;
      if (this.acceptedOwnMessages.peek().length && !this.ownSendCurrent?.()) this.acceptedOwnMessages.value = [];
      if (this.pendingOwnMessage.peek() && !this.ownSendCurrent?.()) {
        this.pendingOwnMessage.value = undefined; this.ownSendCapacityReason.value = false; this.sendState.value = {kind:"idle"};
      }
    }));
    let senderOwner: unknown;
    let senderOwnerGeneration = 0;
    let senderCachedList: unknown;
    let senderOldWindow: unknown;
    let senderOldWindowVersion = 0;
    this.disposers.push(effect(() => {
      const owner = this.data.owner.value;
      const list = this.data.threadList.value;
      if (senderOwner !== owner) { senderOwner = owner; senderOwnerGeneration++; senderCachedList = list.items; senderOldWindow = this.longReader.peek(); senderOldWindowVersion = this.longReader.peek()?.version.peek() ?? 0; }
      const h = this.handle.value;
      const route = this.route.value;
      const connected = this.data.connection.value === "open" && owner.state === "connected" && typeof owner.info.instance_id === "string" && owner.info.instance_id !== "";
      const page = this.senderPage.value;
      const replyCandidates = this.replyPages.owed_by.value.items
        .flatMap(reply => reply.sender.kind === "model" && reply.sender.thread_id ? [reply.sender.thread_id] : []);
      const win = this.longReader.value;
      if (win) win.version.value;
      const items = win ? (win === senderOldWindow && win.version.peek() === senderOldWindowVersion ? [] : win.rangeItems()) : [];
      const ids: string[] = [];
      for (const item of items) { const fact = senderFact(item.provenance?.sender); if (fact.kind === "model") ids.push(fact.threadId); }
      ids.push(...replyCandidates);
      const scope = connected && h && route.view === "conversation" ? JSON.stringify([senderOwnerGeneration, owner.info.instance_id, route.view, h.threadId, page]) : undefined;
      // An owner switch cannot reuse an old list merely because it is still displayed as stale data.
      const cache = !list.stale && list.items !== senderCachedList ? list.items : [];
      untracked(() => this.senderTitles.update(scope, ids, cache));
    }));
    this.disposers.push(effect(() => {
      if (!this.longReader.value) this.retainToolState(this.conversation.value);
    }));
    // A section's reads run when it opens with the owner reachable, not when it renders. A new
    // period re-runs this, so only the open section reads it.
    this.disposers.push(
      effect(() => {
        const route = this.route.value;
        this.insights.period.value;
        // Whatever is no longer showing stops being read.
        if (route.view !== "analytics" && route.view !== "settings") this.insights.showing(undefined);
        if (route.view !== "branches") this.branches.leave();
        if (route.view !== "setup") {
          this.setup.leave();
          this.embedding.leave();
        }
        const connected = this.connection.value === "connected";
        const rolling = route.view === "analytics" && analyticsSection(route) === "overview" && this.insights.rolling.enabled.value;
        if (rolling) {
          const owner = this.data.owner.value;
          const hint = this.data.listHint.value;
          this.insights.showing("rolling-overview");
          const reachable = connected && owner.state === "connected";
          const instance = reachable ? owner.info.instance_id ?? undefined : undefined;
          this.insights.observeRollingOwner(reachable ? instance ?? "connected" : undefined, hint, instance);
          return;
        }
        this.insights.observeRollingOwner(undefined, 0, undefined);
        if (!connected) return;
        const threadId = this.selectedId.value;
        if (route.view === "analytics") this.insights.ensureAnalytics(analyticsSection(route), threadId);
        else if (route.view === "settings") {
          this.insights.ensureSettings(settingsSection(route), threadId);
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
        this.apps.ensure(this.selectedId.value);
        if (route.appName !== undefined) void this.apps.open(route.appName, route.appInstance);
      }),
    );
    // Both views follow the list: a list hint re-reads it, and each change here re-reads once.
    this.disposers.push(
      effect(() => {
        const view = this.route.value.view;
        // Items, not the whole state: its loading flags change without a new list.
        const listState = this.data.threadListMeta.value;
        const list = this.data.listThreadIds.value;
        if (this.connection.value !== "connected" || (view === "branches" && (listState.stale || listState.loading))) return;
        const id = this.selectedId.value;
        if (view === "branches" && id !== undefined) {
          const b = this.branches.state.peek();
          if (b.threadId === id && b.family && lastList !== list) void this.branches.read(id);
          else this.branches.ensure(id);
        }
        lastList = list;
      }),
    );
    // The route's node is applied when the route changes or the family first arrives, never on a re-read:
    // a message chosen on the graph stays chosen across event refreshes.
    let routedNode: string | undefined;
    this.disposers.push(
      effect(() => {
        const route = this.route.value;
        const hasFamily = !!this.branches.state.value.family;
        if (route.view !== "branches") { routedNode = undefined; return; }
        const key = JSON.stringify([this.selectedId.value, route.nodeId, hasFamily]);
        if (key === routedNode) return;
        routedNode = key;
        this.branches.select(this.selectedId.value, route.nodeId);
      }),
    );
    // Marks need one family read per Thread opened, again when the list shows its children changed.
    // Organizational family membership comes from the bounded branches read, not Run ownership.
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
    this.disposers.push(effect(() => {
      const h = this.handle.value;
      const active = this.route.value.view === "conversation";
      if (!h) return;
      untracked(() => h.setWorkActive(active));
      return () => untracked(() => h.setWorkActive(false));
    }));
    // Shell facts follow the hints: the store re-reads the Thread on each, and so do we.
    this.disposers.push(
      effect(() => {
        const h = this.handle.value;
        if (!h) return;
        h.detail.value;
        if (this.route.value.view === "conversation" && h.work.value.value?.items.some((i) => i.kind === "shell")) void this.refreshShells(h.threadId);
      }),
    );
    this.data.start();
  }

  dispose(): void {
    this.config.leave();
    this.attachmentSection.close();
    this.artifacts.close();
    this.panelOperations.value = new Map();
    this.panelDetail.value = undefined;
    this.closeModelPicker();
    this.senderTitles.close();
    this.branchCompare.leave();
    this.branches.leave();
    this.insights.dispose();
    this.pending.close?.();
    this.modelListCancel.cancel();
    // Stop model effects before reader retirement invalidates their accepted-view dependencies.
    for (const d of this.disposers) d();
    this.disposers = [];
    this.releaseConversationReader();
    this.apps.leaveFolders();
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
    if (formatRoute(this.route.peek()) !== formatRoute(route)) this.pendingSettingFocus.value = undefined;
    this.route.value = route;
  }

  /** An accepted exact set can retire local conversation state, but only owner events refresh the list. */
  onThreadSetDeleted(ids: readonly string[]): void {
    const deleted = new Set(ids);
    const active = this.selectedId.peek();
    const route = this.route.peek();
    const accepted = this.acceptedOwnMessages.peek();
    if (accepted.some(message => deleted.has(message.threadId))) {
      this.acceptedOwnMessages.value = accepted.filter(message => !deleted.has(message.threadId));
    }
    const pending = this.pendingOwnMessage.peek();
    if (pending && deleted.has(pending.threadId)) {
      this.pendingOwnMessage.value = undefined;
      this.ownSendCapacityReason.value = false;
      this.sendState.value = { kind: "idle" };
    }
    if (!active || !deleted.has(active)) return;
    const fallback = this.rows.peek().find(row => !deleted.has(row.summary.thread_id))?.summary.thread_id;
    this.lastThread.value = fallback;
    if (route.threadId === active || route.view === "conversation") {
      this.navigate(fallback ? { view: "conversation", threadId: fallback } : { view: "conversation" });
    }
  }

  navigate(route: Route): void {
    if (formatRoute(this.route.peek()) !== formatRoute(route)) this.pendingSettingFocus.value = undefined;
    this.route.value = route;
    this.onNavigate?.(formatRoute(route));
  }

  navigateToSettingFocus(route: Route, settingId: string): void {
    batch(() => {
      this.pendingSettingFocus.value = settingId;
      this.route.value = route;
      this.onNavigate?.(formatRoute(route));
    });
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

  /** Drop the strong reference to accepted rows whenever the conversation reader leaves. */
  private releaseConversationReader(): void {
    const reader = this.longReader.peek();
    batch(() => {
      this.readerThread = undefined;
      this.shellScan = undefined;
      this.longReader.value = undefined;
      reader?.dispose();
    });
  }

  /** One reader per open Thread while the Conversation shows and the owner has the positional read. */
  private syncWindow(): void {
    const h = this.handle.value;
    const want = this.route.value.view === "conversation" && h !== undefined && this.data.capabilities.value.includes(CAPABILITY_HISTORY_WINDOW);
    const cur = this.longReader.peek();
    if (cur && (!want || this.readerThread !== h?.threadId || this.handle.peek() !== h || (h !== undefined && !cur.isCurrentThread(h)))) {
      this.releaseConversationReader(); // leaving the view, Thread, or owner lifetime cancels its reads
    }
    if (!want || !h) return;
    if (!this.longReader.peek()) {
      this.readerThread = h.threadId;
      this.readerTick = h.historyTick.peek();
      const reader = new ConversationWindow({ read: (a, c) => h.readWindow(a, c) }, { bodyStore: this.retainedBodies });
      reader.bindCurrentThread(h);
      reader.bindConversationInput((snapshot, replacement, retiring) => this.captureWindowConversation(reader, h, snapshot, replacement, retiring),
        snapshot => this.applyCommittedOwnRegion(reader, h, snapshot));
      this.longReader.value = reader;
      reader.refreshConversationInput(reader.acceptedView.peek());
    }
    const tick = h.historyTick.value; // a hint: publish semantic facts before waking the reader
    const tickChanged = tick !== this.readerTick;
    if (tickChanged) this.readerTick = tick;
    const reader = this.longReader.peek()!;
    this.composeWindowDisplay(reader, h);
    this.readerShells(reader, tick);
    if (tickChanged && this.longReader.peek() === reader && this.handle.peek() === h) reader.changed();
  }

  private windowConversationSource(reader: ConversationWindow, handle: ThreadHandle, snapshot: WindowAcceptedSnapshot, replacement?: readonly import("../../data/src/handoff").HandoffRecord[]) {
    const scope = this.ownMutationScope();
    const capability = reader.acceptedView.currentCapability;
    const lifetime = handle.liveEpoch();
    const workValue = handle.work.value.value;
    const current = () => this.handle.peek() === handle
      && handle.liveEpoch() === lifetime && reader.acceptedView.currentCapability === capability;
    const records = replacement ?? handle.handoff.value;
    const accepted = this.acceptedOwnMessages.value;
    const pending = this.pendingOwnMessage.value;
    const sendCurrent = this.ownSendCurrent;
    const eligible = !!sendCurrent?.();
    const identity = createConversationIdentity({ scope, rows: snapshot.rows, revision: snapshot.revision, records,
      work: { source: workValue ?? EMPTY_WORK_SOURCE, facts: [] }, current: current() },
      { accepted, pending, sendCurrent, eligible });
    return { scope, workValue, current, records, accepted, pending, eligible, identity };
  }

  private captureWindowConversation(reader: ConversationWindow, handle: ThreadHandle, snapshot: WindowAcceptedSnapshot, replacement?: readonly import("../../data/src/handoff").HandoffRecord[], retiring?: ReadonlySet<string>) {
    const { scope, workValue, current, records, accepted, pending, eligible, identity } = this.windowConversationSource(reader, handle, snapshot, replacement);
    const input = captureConversationInput(snapshot, { scope, threadId: handle.threadId, records,
      work: captureCurrentWork(handle.threadId, workValue), current, retiring });
    const cohortAccepted = eligible ? accepted.filter(row => row.scope === scope && row.threadId === handle.threadId) : [];
    const cohortPending = eligible && pending?.scope === scope && pending.threadId === handle.threadId ? pending : undefined;
    const localRows = [...cohortAccepted, ...(cohortPending ? [cohortPending] : [])];
    const decision = ownSendPresentation(scope, current() ? localRows : [], snapshot.rows, input.liveTail ?? [], input.projection);
    return { ...input, identity: { ...identity, work: input.identity.work },
      decision: { cohortVersion: { accepted: cohortAccepted, pending: cohortPending }, localRegion: decision },
      isCurrent: () => current() && (replacement !== undefined || handle.handoff.peek() === input.identity.records)
        && (handle.work.peek().value === input.identity.work.source || handle.work.peek().value === undefined && input.identity.work.facts.length === 0) };
  }

  private composeWindowDisplay(reader: ConversationWindow, handle: ThreadHandle): void {
    const snapshot = reader.acceptedView.peek();
    if (!reader.acceptedView.isCurrent(snapshot)) return;
    reader.refreshConversationInput(snapshot, () => this.windowConversationSource(reader, handle, snapshot).identity);
    const currentSnapshot = reader.acceptedView.peek();
    const tailComplete = currentSnapshot.total === 0 || currentSnapshot.range?.last === currentSnapshot.total - 1;
    const candidate = tailComplete ? latestAssistant(currentSnapshot.rows) : undefined;
    if (candidate?.node_id !== undefined && (candidate.items === null || candidate.items?.some((item) => item.kind === "text" && item.text_complete === false))) {
      const kind = candidate.items === null ? "deferred" as const : "typed" as const;
      if (candidate.items === null) return;
      const allProse = candidate.items !== undefined && candidate.items.length > 0 && candidate.items.every(item => item.kind === "text");
      if (!allProse) return;
      const identity = undefined;
      let readers = this.autoBodyReads.get(handle);
      if (!readers) { readers = new WeakMap(); this.autoBodyReads.set(handle, readers); }
      const key = `${candidate.node_id}:${kind}:${identity ?? "deferred"}`;
      if (this.bodyState(candidate.node_id, identity) === undefined && readers.get(reader) !== key) {
        readers.set(reader, key);
        void this.loadBody(candidate.node_id, { handle, reader, kind, identity });
      }
    }
  }

  /** Shell facts for the steps in view, read while it shows some. */
  private readerShells(w: ConversationWindow, tick: number): void {
    const { rows } = w.acceptedView.current;
    const previous = this.shellScan;
    // Live-only publications reuse the saved rows; only owner hints or a new range need a scan.
    if (previous?.reader === w && previous.rows === rows && previous.tick === tick) return;
    this.shellScan = { reader: w, rows, tick };
    if (this.toolStepChoices.peek().size || this.openToolGroups.peek().size)
      this.retainToolState(materializeHistoryPresentation(w.rangeItems()).rows, new Set(w.heldSteps().flatMap((item) => (item.executions ?? []).map((step) => step.execution_id))));
    const r = w.renderRange();
    if (!r || !this.handle.peek()) return;
    for (let i = r.first; i <= r.last; i++)
      if ((w.itemAt(i)?.executions?.length ?? 0) > 0) {
        void this.refreshShells(this.handle.peek()!.threadId);
        return;
      }
  }

  /** Expansion choices live no longer than the history they describe. */
  private retainToolState(rows: readonly ConversationRow[], heldSteps?: ReadonlySet<string>): void {
    const groups = rows.filter((row) => row.type === "steps");
    const steps = heldSteps ?? new Set(groups.flatMap((row) => row.steps.map((step) => step.executionId)));
    const choices = this.toolStepChoices.peek();
    const keptChoices = new Map([...choices].filter(([id]) => steps.has(id)));
    if (keptChoices.size !== choices.size) this.toolStepChoices.value = keptChoices;
    const allowed = new Set(groups.flatMap((row) => [row.id, ...row.steps.map((step) => `step:${step.executionId}`)]));
    const opened = this.openToolGroups.peek();
    const kept = new Set([...opened].filter((id) => allowed.has(id)));
    if (kept.size !== opened.size) this.openToolGroups.value = kept;
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
    this.panelTab.value = "work";
    this.panelOpener.value = {};
    this.panelOperations.value = new Map();
    this.panelDetail.value = undefined;
    this.watchedOutputs.clear();
    this.sendState.value = { kind: "idle" };
    this.openToolGroups.value = new Set();
    this.toolStepChoices.value = new Map();
    this.actionError.value = undefined;
    let ordinal = 0;
    this.nextTailOrdinal = () => ++ordinal;
    this.handle.value = this.data.openThread(id, this.nextTailOrdinal);
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
          for (const [id, watch] of this.watchedOutputs) {
            const fact = this.shells.value.get(id);
            if (!fact || this.outputReads.has(id)) continue;
            if (fact.state !== watch.state || statusOfShell(fact.state, fact.exit_code) === "running") {
              watch.state = fact.state;
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
    let watch = this.watchedOutputs.get(executionId);
    if (watch) watch.count++;
    else {
      watch = { count: 1, state: this.shells.peek().get(executionId)?.state };
      this.watchedOutputs.set(executionId, watch);
      void this.readOutput(executionId);
    }
    let released = false;
    return () => {
      if (released || this.watchedOutputs.get(executionId) !== watch) return;
      released = true;
      if (--watch.count > 0) return;
      this.watchedOutputs.delete(executionId);
      const cancel = this.outputReads.get(executionId);
      this.outputReads.delete(executionId);
      if (this.outputs.peek().get(executionId)?.loading) {
        const next = new Map(this.outputs.peek()); next.delete(executionId); this.outputs.value = next;
      }
      cancel?.cancel();
    };
  }

  private async readOutput(executionId: string): Promise<void> {
    const previous = this.outputReads.get(executionId);
    const cancel = new Cancel();
    this.outputReads.set(executionId, cancel);
    previous?.cancel();
    if (this.outputReads.get(executionId) !== cancel) return;
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
    // A validated empty output is still a saved result, not first-load absence.
    if (!cur || cur.loading || (cur.error !== undefined && !cur.expired)) this.outputs.value = setBounded(this.outputs.peek() as Map<string, OutputState>, executionId, {
      text: cur?.text ?? "",
      ...(cur?.stderr && { stderr: cur.stderr }),
      loading: true,
      cutOff: cur?.cutOff ?? false,
      error: undefined,
    });
    let text = "";
    const stderr: StderrRange[] = [];
    let cursor: string | undefined;
    let error: string | undefined;
    let cutOff = false;
    let expired = false;
    for (let page = 0; ; page++) {
      if (page === MAX_PAGES) {
        cutOff = true;
        break;
      }
      const out = await this.ops.shellRead({ execution_id: executionId, segments: true, ...(cursor !== undefined && { cursor }) }, { cancel });
      if (this.outputReads.get(executionId) !== cancel) return;
      if (!out.ok) {
        if (out.error.kind === "cancelled") {
          // Keep an already validated snapshot; only discard an unfinished first load.
          if (cur && !cur.loading && cur.error === undefined) return;
          const next = new Map(this.outputs.peek());
          next.delete(executionId);
          this.outputs.value = next;
          return;
        }
        expired = out.error.kind === "owner" && out.error.code === "output_expired";
        error = errorMessage(out.error);
        break;
      }
      if (out.value.execution_id !== executionId) {
        error = "shell.read returned a different execution";
        break;
      }
      for (const { start, end } of out.value.stderr ?? []) stderr.push({ start: text.length + start, end: text.length + end });
      text += out.value.text;
      cursor = out.value.cursor;
      if (out.value.text === "" || cursor === undefined) break;
    }
    const ranges = expired ? undefined : error !== undefined ? cur?.stderr : stderr.length ? stderr : undefined;
    const next: OutputState = { text: expired ? "" : error !== undefined ? (cur?.text ?? "") : text, loading: false, cutOff, error, ...(ranges && { stderr: ranges }), ...(expired && { expired }) };
    const current = this.outputs.peek().get(executionId);
    if (current?.text === next.text && current.loading === next.loading && current.cutOff === next.cutOff && current.error === next.error && current.expired === next.expired &&
        current.stderr?.length === ranges?.length &&
        (!ranges || ranges.every(({ start, end }, i) => current.stderr?.[i]?.start === start && current.stderr[i]?.end === end))) return;
    this.outputs.value = setBounded(this.outputs.peek() as Map<string, OutputState>, executionId, next);
  }

  /** Read one message beyond its excerpt. On request only. */
  async loadBody(nodeId: string, expected?: { handle?: ThreadHandle; reader?: ConversationWindow; kind: "deferred" | "typed"; identity?: string }, panel?: HistoryBodies): Promise<void> {
    const handle = expected?.handle ?? this.handle.peek();
    const reader = expected !== undefined && Object.prototype.hasOwnProperty.call(expected, "reader") ? expected.reader : this.longReader.peek();
    const route = this.route.peek();
    const bodies = panel ?? reader?.bodies;
    if (!handle || !bodies || this.longReader.peek() !== reader) return;
    const cacheKey = HistoryBodies.key(nodeId, expected?.identity);
    const position = { nodeId, ordinal: panel ? undefined : reader?.acceptedView.peek().rows.find(row => row.node_id === nodeId)?.selection?.ordinal };
    const tokens = bodies.reads;
    const set = (body: BodyState | undefined) => bodies.set(cacheKey, body);
    const autoQualified = () => {
      if (reader === undefined) return false;
      const snapshot = reader.acceptedView.peek();
      if (!reader.acceptedView.isCurrent(snapshot) || snapshot.range?.last !== snapshot.total - 1) return false;
      const newest = [...snapshot.rows].reverse().find(row => row.kind === "assistant_response");
      return newest?.node_id === nodeId && newest.items !== null && newest.items !== undefined && newest.items.length > 0 && newest.items.every(item => item.kind === "text");
    };
    if (expected?.kind === "typed" && reader !== undefined) {
      const row = reader.acceptedView.peek().rows.find(row => row.node_id === nodeId);
      if (!row || !row.items || row.items.length === 0 || !row.items.every(item => item.kind === "text") || expected.handle !== undefined && !autoQualified()) return;
    }
    const cached = bodies.peek(cacheKey);
    if (cached?.text !== undefined && !cached.loading && cached.error === undefined && cached.continuation === undefined && !cached.budgetLimited) {
      bodies.touch(cacheKey);
      return;
    }
    // One cache-slot owner; a manual click upgrades that token without a second RPC.
    const existing = tokens.get(cacheKey);
    if (existing !== undefined) {
      if (expected?.handle === undefined) existing.manualAuthorized = true;
      return;
    }
    const token = { position, manualAuthorized: expected?.handle === undefined, cancel: new Cancel() };
    tokens.set(cacheKey, token);
    const cancel = this.threadReads;
    const lifetime = handle.liveEpoch();
    const forget = panel ? undefined : cancel.add(() => token.cancel.cancel());
    const qualified = () => this.handle.peek() === handle && handle.liveEpoch() === lifetime
      && this.longReader.peek() === reader && this.threadReads === cancel && this.route.peek() === route
      && (expected === undefined || (reader !== undefined
        ? reader.acceptedView.isCurrent(reader.acceptedView.peek()) && reader.acceptedView.peek().rows.some((row) => row.node_id === nodeId
          && (expected.kind === "deferred" ? row.items === null : row.items !== null && row.items !== undefined && row.items.length > 0 && row.items.every((item) => item.kind === "text") && (expected.identity === undefined ? (token.manualAuthorized || expected.handle === undefined || autoQualified()) : row.items.some((item) => item.item_identity === expected.identity))))
        : false));
    const current = () => this.handle.peek() === handle && handle.liveEpoch() === lifetime
      && this.longReader.peek() === reader && this.threadReads === cancel && this.route.peek() === route;
    const unpin = bodies.pin(cacheKey);
    let text = cached?.text ?? "";
    let cursor = cached?.continuation;
    const stop = token.cancel.add(() => {
      if (bodies.peek(cacheKey)?.loading) set(cached);
      unpin();
    });
    try {
      if (!set({ text: cached?.text, loading: true, error: undefined, continuation: cursor })) return;
      for (;;) {
        if (token.cancel.cancelled || !current() || !qualified() || tokens.get(cacheKey) !== token) {
          if (tokens.get(cacheKey) === token && bodies.peek(cacheKey)?.loading) {
            set(undefined);
          }
          return;
        }
        const out = await this.ops.historyGet({ node_id: nodeId, ...(cursor !== undefined && { cursor }) }, { cancel: token.cancel });
        if (token.cancel.cancelled || !current() || !qualified() || tokens.get(cacheKey) !== token) {
          if (tokens.get(cacheKey) === token && bodies.peek(cacheKey)?.loading) {
            set(undefined);
          }
          return;
        }
        if (!out.ok) {
          set({ text: undefined, loading: false, error: out.error.kind === "cancelled" ? undefined : errorMessage(out.error) });
          return;
        }
        if (out.value.node_id !== nodeId) {
          set({ text: undefined, loading: false, error: "history body node mismatch" });
          return;
        }
        const next = text + out.value.text;
        const continuation = out.value.next_cursor;
        if (!set({ text: next, loading: continuation !== undefined, error: undefined, continuation })) {
          set({ text: cursor === undefined ? undefined : text, loading: false, error: undefined, continuation: cursor, budgetLimited: true });
          return;
        }
        text = next;
        if (continuation === undefined) return;
        if (continuation === cursor) {
          set({ text, loading: false, error: "History body continuation did not advance", continuation: cursor });
          return;
        }
        cursor = continuation;
      }
    } finally {
      stop();
      unpin();
      forget?.();
      if (tokens.get(cacheKey) === token) tokens.delete(cacheKey);
    }
  }

  // ---- actions (state changes arrive through hints and re-reads) ----

  async send(text: string, onReserved?: () => void): Promise<boolean> {
    const threadId = this.selectedId.value;
    if (threadId === undefined || text.trim() === "") return false;
    return this.deliver(threadId, text, undefined, onReserved);
  }

  /** Repeat an unconfirmed send with the same operation id: the owner's receipt prevents a double. */
  async resend(original?:PendingOwnMessage): Promise<boolean> {
    const state = this.sendState.value;
    const threadId = this.selectedId.value;
    const pending = this.pendingOwnMessage.peek();
    if (!pending || (original && original!==pending) || !this.ownSendCurrent?.() || threadId !== pending.threadId || !["failed", "unconfirmed"].includes(pending.phase)) return false;
    return this.deliver(threadId, pending.text, pending.operationId);
  }

  localSendAdmission(text:string) {
    const handle=this.handle.value;
    if(!handle||handle.threadId!==this.selectedId.value)return "unavailable" as const;
    const admission=localSendAdmission(!!this.pendingOwnMessage.value,this.acceptedOwnMessages.value,text);
    if(admission!=="ready")return admission;
    return this.data.owner.value.state==="connected"?admission:"unavailable" as const;
  }
  canResend(original?:PendingOwnMessage):boolean {
    const pending=this.pendingOwnMessage.value;
    return (!original||original===pending) && this.data.owner.value.state==="connected" && !!pending && this.handle.value?.threadId===pending.threadId && this.selectedId.value===pending.threadId && ["failed","unconfirmed"].includes(pending.phase) && this.pendingOwnIsCurrent();
  }
  ownSendBlocked(): boolean {
    return !!this.pendingOwnMessage.value || this.acceptedOwnMessages.value.length >= 8;
  }

  ownMutationScope(): string { return this.acceptedOwnMessages.value[0]?.scope ?? this.pendingOwnMessage.value?.scope ?? "history"; }
  ownMutationRows(scope: string): readonly PendingOwnMessage[] {
    const accepted=this.acceptedOwnMessages.value, pending=this.pendingOwnMessage.value;
    return [...accepted,...(pending?[pending]:[])].filter(row=>row.scope===scope);
  }
  pendingOwnIsCurrent(): boolean { return !!this.ownSendCurrent?.(); }
  private applyCommittedOwnRegion(reader: ConversationWindow, handle: ThreadHandle, snapshot: WindowAcceptedSnapshot): void {
    const plan = snapshot.displayPlan;
    const current = () => this.longReader.peek() === reader && this.handle.peek() === handle
      && reader.acceptedView.isCurrent(snapshot) && plan?.capability === reader.acceptedView.currentCapability;
    if (!plan || !current()) return;
    const region = plan.localRegion;
    if (!region.retire.length || !this.ownSendCurrent?.()) return;
    const rows = this.ownMutationRows(region.scope);
    const sameRow = (a: PendingOwnMessage, b: PendingOwnMessage) => a.operationId === b.operationId
      && a.threadId === b.threadId && a.scope === b.scope && a.messageId === b.messageId
      && a.phase === b.phase && a.plainMessageSend === b.plainMessageSend;
    if (rows.length !== region.cohort.length || rows.some((row, index) => !sameRow(row, region.cohort[index]!)) || !current()) return;
    const retiring = new Set(region.retire.map(row => row.operationId));
    const previous = this.acceptedOwnMessages.peek();
    const kept = previous.filter(row => !retiring.has(row.operationId));
    const pending = this.pendingOwnMessage.peek();
    batch(() => {
      if (kept.length !== previous.length) this.acceptedOwnMessages.value = kept;
      if (pending && retiring.has(pending.operationId)) {
        this.pendingOwnMessage.value = undefined;
        this.sendState.value = { kind: "idle" };
      }
      this.ownSendCapacityReason.value = false;
    });
  }

  private async deliver(threadId: string, text: string, operationId = this.ops.mutationId(), onReserved?: () => void): Promise<boolean> {
    const handle = this.handle.peek(), route = this.route.peek();
    if (!handle || handle.threadId !== threadId) return false;
    const old = this.pendingOwnMessage.peek();
    if (old && (old.operationId !== operationId || old.text !== text)) return false;
    if (old?.operationId === operationId && old.phase === "sending") return false;
    if (!old) {
      const admission=localSendAdmission(false,this.acceptedOwnMessages.peek(),text);
      if(admission!=="ready"){this.ownSendCapacityReason.value=true;return false;}
    }
    this.ownSendCapacityReason.value=false;
    const owner = this.data.owner.peek(), scope = "history";
    if (owner.state !== "connected") return false;
    const current = () => {
      const now = this.data.owner.peek();
      return this.handle.peek() === handle && this.route.peek() === route &&
        (now.state !== "connected" || now.info.instance_id === owner.info.instance_id);
    };
    this.ownSendCurrent = current;
    this.pendingOwnMessage.value = {threadId,scope,operationId,text,phase:"sending",plainMessageSend:true,clientOrdinal:old?.clientOrdinal ?? this.nextTailOrdinal()};
    this.sendState.value = { kind: "sending" };
    const originalPlainOperation=this.pendingOwnMessage.peek();
    if(current()&&originalPlainOperation?.operationId===operationId){
      // A UI observer cannot orphan an already-owned send by throwing.
      try { onReserved?.(); } catch { /* The pending operation still owns the text. */ }
    }
    if(!current()||this.data.owner.peek().state!=="connected"||!originalPlainOperation||this.pendingOwnMessage.peek()!==originalPlainOperation||this.sendState.peek().kind!=="sending"){
      if(this.pendingOwnMessage.peek()===originalPlainOperation){
        this.pendingOwnMessage.value={...originalPlainOperation!,phase:"failed"};
        this.sendState.value={kind:"failed",message:"Send reservation is no longer current"};
      }
      return false;
    }
    const out = await this.ops.messageSend({ thread_id: threadId, text, deliver: "next" }, operationId);
    if (!current() || this.pendingOwnMessage.peek() !== originalPlainOperation) return false;
    if (out.ok && out.value.thread_id === threadId) {
      const accepted = originalPlainOperation;
      batch(() => {
        this.acceptedOwnMessages.value = [...this.acceptedOwnMessages.peek(), { ...accepted, phase: "accepted", messageId: out.value.message_id, ...(out.value.delivery_status === "held" && { heldAtAcceptance: { hint: typeof out.value.hint === "string" ? out.value.hint : undefined, operationId: out.ownerOperationId } }) }];
        this.pendingOwnMessage.value = undefined;
        this.sendState.value = { kind: "idle" };
      });
      return true;
    }
    if (out.ok) {
      this.pendingOwnMessage.value = {...originalPlainOperation,phase:"failed"};
      this.sendState.value = {kind:"failed",message:"Message acceptance belongs to a different Thread"};
      return false;
    }
    const uncertain = out.error.kind === "unconfirmed";
    this.pendingOwnMessage.value = {...originalPlainOperation,phase:uncertain?"unconfirmed":"failed"};
    this.sendState.value = uncertain
      ? { kind: "unconfirmed", operationId, text }
      : { kind: "failed", message: errorMessage(out.error), diagnostic: { ...(out.error.kind === "owner" ? { code: out.error.code, hint: out.error.hint } : out.error.kind === "bridge" ? { code: out.error.code } : {}), operationId: out.ownerOperationId }, ...(out.error.kind === "owner" && needsConnectionSetup(out.error.code, out.error.details) ? { configuration: true } : {}) };
    return false;
  }

  async createAppRequest(text: string, cwd: string): Promise<boolean> {
    if (!text.trim() || !cwd.trim() || this.appRequestState.peek().kind === "sending" || this.appRequestState.peek().kind === "unconfirmed") return false;
    this.appRequestState.value = { kind: "sending" };
    const created = await this.ops.threadCreate({ cwd: cwd.trim() });
    if (!created.ok) {
      this.appRequestState.value = { kind: created.error.kind === "unconfirmed" ? "unconfirmed" : "failed", message: created.error.kind === "unconfirmed" ? this.t.value("work.cancelUnconfirmed", { id: created.error.operationId }) : errorMessage(created.error) };
      return false;
    }
    const id = created.value.thread_id;
    const sent = await this.ops.messageSend({ thread_id: id, text });
    if (!sent.ok) {
      this.appRequestState.value = { kind: "unconfirmed", message: `${id}: ${sent.error.kind === "unconfirmed" ? this.t.value("work.cancelUnconfirmed", { id: sent.error.operationId }) : errorMessage(sent.error)}` };
      return false;
    }
    this.appRequestState.value = { kind: "idle" };
    this.openThread(id);
    return true;
  }

  bindPanelPreference(preference: PanelPreference): () => void {
    this.panelPreference = preference;
    return () => { if (this.panelPreference === preference) this.panelPreference = undefined; };
  }

  togglePanel(): void {
    const preference = this.panelPreference;
    if (preference?.visible()) preference.write(!preference.collapsed());
  }

  private expandPanel(): void {
    if (this.panelPreference?.visible() && this.panelPreference.collapsed()) this.panelPreference.write(false);
  }

  observeThreadAnalytics(threadId: string) {
    const cancel = new Cancel();
    let reading = false, again = false;
    const usage = signal<UsageFacts | undefined>(undefined);
    const compactions = signal<readonly CompactionEvent[] | undefined>(undefined);
    const status = signal({ loading: true, usageFailed: false, compactionsFailed: false });
    const refresh = async () => {
      if (reading) { again = true; return; }
      reading = true;
      do {
        again = false;
        const [totals, recent] = await Promise.all([
          this.ops.usageGet({ thread_id: threadId }, { cancel }),
          this.ops.compactList({ thread_id: threadId, limit: 3 }, { cancel }),
        ]);
        if (cancel.cancelled) return;
        batch(() => {
          usage.value = totals.ok && totals.value.thread_id === threadId ? usageFacts(totals.value) : undefined;
          status.value = { loading: false, usageFailed: !totals.ok, compactionsFailed: !recent.ok };
          compactions.value = recent.ok && Array.isArray(recent.value.items)
            ? recent.value.items.slice(0, 3).flatMap(item => readCompactionEvent(item) ?? []) : undefined;
        });
      } while (again);
      reading = false;
    };
    const hints = this.data.watchHints(threadId, () => void refresh());
    void refresh();
    return { usage, compactions, status, close: () => { cancel.cancel(); hints.close(); } };
  }

  setPanelTab(tab: RightPanelTab): void {
    batch(() => { this.panelTab.value = tab; this.panelDetail.value = undefined; this.expandPanel(); });
  }

  openInPanel(target: RightPanelTarget, opener?: () => boolean, fromPanel = false): void {
    if (!fromPanel && this.panelPreference && !this.panelPreference.visible()) return;
    const tab: RightPanelTab = (target.kind === "attachment" || target.kind === "artifact") ? "possessions" : target.kind === "reply"
      ? target.replySide === "owed_by" ? "reply-needed" : "awaiting-reply"
      : "work";
    batch(() => {
      this.panelTab.value = tab;
      this.panelOpener.value = { ...this.panelOpener.peek(), [tab]: target };
      this.panelDetail.value = { ...target, opener };
      this.expandPanel();
    });
  }

  closePanelDetail(): void { this.panelDetail.value = undefined; }

  private panelOperationFacts() {
    const handle = this.handle.value;
    const work = handle?.work.value;
    return {
      pending: work?.value && !work.loading && !work.stale && !work.error ? work.value : undefined,
      owed_by: this.replyPages.owed_by.value,
      asked_by: this.replyPages.asked_by.value,
    };
  }

  private settlePanelOperations(): void {
    const { pending, owed_by, asked_by } = this.panelOperationFacts();
    const current = this.panelOperations.peek();
    let next: Map<string, PanelOperation> | undefined;
    for (const [id, operation] of current) {
      if (operation.disposition !== "pending") continue;
      const state = operation.source === "pending"
        ? pending?.items.find(row => row.kind === "message" && row.message_id === id)?.state
        : (operation.source === "owed_by" ? owed_by : asked_by).items.some(row => row.message_id === id) ? "pending" : undefined;
      const page = operation.source === "owed_by" ? owed_by : asked_by;
      const complete = operation.source === "pending" ? pending !== undefined && pending.next_cursor === undefined : !page.loading && page.complete;
      if (state === undefined ? complete : state !== operation.state) (next ??= new Map(current)).delete(id);
    }
    if (next) this.panelOperations.value = next;
  }

  async runPanelOperation(id: string, action: { kind: "cancel"; target: "pending" | "reply" } | { kind: "answer"; text: string; side?: ReplySide }): Promise<void> {
    const next = new Map(this.panelOperations.peek());
    const previous = next.get(id);
    const handle = this.handle.peek();
    if (!handle || this.connection.peek() !== "connected" || (previous && previous.disposition !== "failed")) return;
    if (!next.has(id) && next.size >= CACHE_ENTRIES) {
      const settled = [...next].find(([, state]) => state.disposition === "failed");
      if (!settled) return;
      next.delete(settled[0]);
    }
    const facts = this.panelOperationFacts();
    const side = action.kind === "answer" ? action.side ?? "asked_by" : "asked_by";
    const source = action.kind === "cancel" && action.target === "pending" ? "pending" : side;
    const reply = source === "pending" ? undefined : facts[source].items.find(row => row.message_id === id);
    if (action.kind === "answer" && (!reply || source !== "owed_by" && !(reply.recipient.kind === "name" && reply.recipient.name === "human"))) return;
    const state = source === "pending"
      ? facts.pending?.items.find(row => row.kind === "message" && row.message_id === id)?.state
      : reply ? "pending" : undefined;
    if (state === undefined) return;
    const pending: PanelOperation = { kind: action.kind, disposition: "pending", source, state };
    next.set(id, pending);
    this.panelOperations.value = next;
    const result = action.kind === "cancel" ? await this.cancelPending(id, action.target) : await this.submitReply(id, action.text);
    // Success is settled by the source, not the RPC. Late failures cannot recreate a record.
    if (!result || this.handle.peek() !== handle || this.selectedId.peek() !== handle.threadId || this.panelOperations.peek().get(id) !== pending) return;
    this.panelOperations.value = new Map(this.panelOperations.peek()).set(id, { kind: action.kind, ...result });
  }

  private panelFailure(error: OpError, cancel = false): PanelFailure {
    return error.kind === "unconfirmed" ? { disposition: "unconfirmed", error: cancel ? this.t.peek()("work.cancelUnconfirmed", { id: error.operationId }) : errorMessage(error) }
      : { disposition: "failed", error: errorMessage(error) };
  }

  private async submitReply(id: string, text: string): Promise<PanelFailure | undefined> {
    const out = await this.ops.messageReply(id, text);
    return out.ok ? undefined : this.panelFailure(out.error);
  }

  private async cancelPending(messageId: string, kind: "pending" | "reply"): Promise<PanelFailure | undefined> {
    const out = await this.ops.messageCancel(messageId);
    if (!out.ok) return this.panelFailure(out.error, true);
    const failure = messageCancelFailure(out.value, messageId, kind);
    if (failure !== undefined) return { disposition: "failed", error: failure };
  }

  async stopModel(turnId: string): Promise<void> {
    this.report("action.interrupt", await this.ops.turnInterrupt(turnId));
  }

  async stopRun(runId: string): Promise<void> {
    this.report("action.stop", await this.ops.runStop(runId));
  }

  async backgroundShell(executionId: string): Promise<void> {
    const threadId = this.handle.peek()?.threadId;
    if (!threadId || this.shells.peek().get(executionId)?.thread_id !== threadId) return;
    this.report("action.shellBackground", await this.ops.shellBackground(executionId));
  }

  async stopShell(executionId: string): Promise<void> {
    const threadId = this.handle.peek()?.threadId;
    if (!threadId || this.shells.peek().get(executionId)?.thread_id !== threadId) return;
    this.report("action.shellStop", await this.ops.shellStop(executionId));
  }


  /** Retry the open Thread, or any Thread: its Run is read first, the list doesn't carry it. */
  async retry(threadId?: string): Promise<void> {
    const id = threadId ?? this.selectedId.value;
    if (id === undefined) return;
    const details = await this.ops.threadGet(id);
    if (!details.ok) return this.report("action.retry", details);
    const runId = details.value.run_id;
    if (runId === undefined) { this.actionError.value = { kind: "error", text: this.t.value("action.retryNoRun") }; return; }
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

  private report(action: "action.stop" | "action.interrupt" | "action.retry" | "action.archive" | "action.new" | "action.shellBackground" | "action.shellStop", out: { ok: true } | { ok: false; error: OpError }): void {
    this.actionError.value = out.ok
      ? { kind: "success", text: this.t.value("action.succeeded", { action: this.t.value(action) }) }
      : { kind: "error", text: this.t.value("action.failed", { action: this.t.value(action), message: errorMessage(out.error) }) };
  }
}
