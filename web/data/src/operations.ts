// Typed operations: the UX boundary for requests. Stateless wrappers over `Link.call`;
// they never touch the store (saved facts change only by re-reading after a hint).
import { decodeStored, decodeTest, encodeCredentialsClear, encodeCredentialsSet, encodeTest, type StoredFacts, type TestFacts, type TestTarget } from "./connection-setup";
import { fromApiError, type Outcome } from "./errors";
import type { Link } from "./link";
import type {
  CompactListArgs,
  HistoryBody,
  HistoryGetArgs,
  HistoryItem,
  HistoryListArgs,
  HistoryWindowArgs,
  HistoryWindowResult,
  MessageSendArgs,
  ModelListArgs,
  ModelListResult,
  OwnerResponse,
  NamesArgs,
  Page,
  ShellEntry,
  ShellListArgs,
  ShellOutput,
  ShellReadArgs,
  ThreadBranchesArgs,
  ThreadCreateArgs,
  ThreadDetails,
  ThreadForkArgs,
  ThreadListArgs,
  ThreadRewindArgs,
  ThreadSummary,
  ThreadTagArgs,
  TagResult,
  UsageGetArgs,
  WorkItem,
} from "./protocol";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };
type Decoder<T> = (v: unknown) => Decoded<T>;

function pageOf<T>(item: (v: unknown) => string | undefined): Decoder<Page<T>> {
  return (v) => {
    if (!isObject(v) || !Array.isArray(v.items)) return { ok: false, reason: "expected a page with items" };
    for (const it of v.items) {
      const why = item(it);
      if (why) return { ok: false, reason: why };
    }
    if (v.next_cursor !== undefined && v.next_cursor !== null && typeof v.next_cursor !== "string")
      return { ok: false, reason: "next_cursor must be a string" };
    const page: Page<T> = { items: v.items as T[] };
    if (typeof v.next_cursor === "string") page.next_cursor = v.next_cursor;
    return { ok: true, value: page };
  };
}

const summaryProblem = (v: unknown): string | undefined =>
  !(isObject(v) && typeof v.thread_id === "string" && typeof v.title === "string" && typeof v.state === "string")
    ? "thread summary lacks thread_id, title or state"
    : v.tags !== undefined && !(Array.isArray(v.tags) && v.tags.every((t) => typeof t === "string"))
      ? "thread summary tags is not a list of strings"
      : undefined;

const decodeThreadPage = pageOf<ThreadSummary>(summaryProblem);
const decodeHistoryPage = pageOf<HistoryItem>((v) => (isObject(v) ? undefined : "history item is not an object"));
const decodeHistoryWindow: Decoder<HistoryWindowResult> = (v) =>
  isObject(v) &&
  Array.isArray(v.items) &&
  typeof v.total === "number" &&
  (typeof v.revision === "string" || typeof v.revision === "number") &&
  v.items.every((i) => isObject(i) && typeof (i.selection as { ordinal?: unknown } | undefined)?.ordinal === "number")
    ? { ok: true, value: v as unknown as HistoryWindowResult }
    : { ok: false, reason: "history.window result lacks items with ordinals, total or revision" };
const decodeDetails: Decoder<ThreadDetails> = (v) =>
  isObject(v) && typeof v.thread_id === "string" && typeof v.title === "string"
    ? { ok: true, value: v as ThreadDetails }
    : { ok: false, reason: "thread.get result lacks thread_id or title" };
const decodeShellPage = pageOf<ShellEntry>((v) =>
  isObject(v) && typeof v.execution_id === "string" && typeof v.state === "string"
    ? undefined
    : "shell entry lacks execution_id or state",
);
const workPage = pageOf<WorkItem>((v) =>
  isObject(v) && typeof v.kind === "string" && typeof v.id === "string" && typeof v.state === "string" && typeof v.thread_id === "string"
    ? undefined : "status item lacks kind, id, state or thread_id",
);
const decodeWorkPage: Decoder<Page<WorkItem>> = (v) => {
  const decoded = workPage(v);
  return decoded.ok && decoded.value.items.length > 200 ? { ok: false, reason: "status page exceeds 200 items" } : decoded;
};
const decodeBody: Decoder<HistoryBody> = (v) =>
  isObject(v) && typeof v.node_id === "string" && typeof v.text === "string"
    ? { ok: true, value: v as HistoryBody }
    : { ok: false, reason: "history.get result lacks node_id or text" };
const decodeShellOutput: Decoder<ShellOutput> = (v) =>
  isObject(v) && typeof v.execution_id === "string" && typeof v.text === "string"
    ? { ok: true, value: v as ShellOutput }
    : { ok: false, reason: "shell.read result lacks execution_id or text" };
const decodeNames = pageOf<string>((v) => (typeof v === "string" ? undefined : "a name in the page is not a string"));
const decodeTagResult: Decoder<TagResult> = (v) =>
  isObject(v) && Array.isArray(v.changed) && Array.isArray(v.unchanged) && Array.isArray(v.not_found)
    ? { ok: true, value: v as unknown as TagResult }
    : { ok: false, reason: "thread.tag result lacks changed, unchanged or not_found" };
const decodeRecord: Decoder<Record<string, unknown>> = (v) =>
  isObject(v) ? { ok: true, value: v } : { ok: false, reason: "expected an object result" };

const decodeModelList: Decoder<ModelListResult> = (v) =>
  isObject(v) && typeof v.connection === "string" && Array.isArray(v.models) && v.models.every((m) => typeof m === "string" && m.length > 0 && !/[\s\x00-\x1f\x7f]/.test(m))
    ? { ok: true, value: v as unknown as ModelListResult }
    : { ok: false, reason: "model.list result lacks connection or models" };

export type MutationResult = Record<string, unknown>;
export interface ArchiveResult {
  archived?: string[];
  already?: string[];
  unarchived?: string[];
  not_found?: string[];
  descendants?: string[];
  [extra: string]: unknown;
}

/** Hooks for reads. */
export interface ReadOptions {
  onSent?: () => void;
  /** Cancels the call: dropped if queued, and a `cancel` frame if sent. */
  cancel?: Cancel;
  /** See `CallOptions.waits`. */
  waits?: boolean;
}

/** Cancels whatever registered with it. Later registrations run at once. */
export class Cancel {
  private done = false;
  private readonly actions = new Set<() => void>();
  get cancelled(): boolean {
    return this.done;
  }
  add(action: () => void): () => void {
    if (this.done) {
      action();
      return () => {};
    }
    this.actions.add(action);
    return () => this.actions.delete(action);
  }
  cancel(): void {
    if (this.done) return;
    this.done = true;
    for (const a of [...this.actions]) a();
    this.actions.clear();
  }
}

export type UuidFn = () => string;

function unwrap<T>(response: OwnerResponse, decode: Decoder<T>): Outcome<T> {
  if (!response.ok) {
    return response.error
      ? { ok: false, error: fromApiError(response.error) }
      : { ok: false, error: { kind: "invalid_response", message: "owner error without error body" } };
  }
  if (response.result === undefined)
    return { ok: false, error: { kind: "invalid_response", message: "owner reply without result" } };
  const value = decode(response.result);
  return value.ok
    ? { ok: true, value: value.value }
    : { ok: false, error: { kind: "invalid_response", message: value.reason } };
}

export class Operations {
  constructor(
    private readonly link: Link,
    private readonly newId: UuidFn,
  ) {}

  private async run<T>(
    command: string,
    args: unknown,
    decode: Decoder<T>,
    mutation?: { operationId: string },
    read?: ReadOptions,
  ): Promise<Outcome<T>> {
    const { cancel, ...options } = read ?? {};
    const handle = this.link.call(command, args, mutation ? { operationId: mutation.operationId, mutation: true } : options);
    const forget = cancel?.add(() => handle.cancel());
    const reply = await handle.promise;
    forget?.();
    const extra = mutation ? { operationId: mutation.operationId } : {};
    if (!reply.ok) return { ok: false, error: reply.error, ...extra };
    return { ...unwrap(reply.response, decode), ...extra };
  }

  // ---- reads ----
  threadList(args: ThreadListArgs = {}, read?: ReadOptions): Promise<Outcome<Page<ThreadSummary>>> {
    return this.run("thread.list", args, decodeThreadPage, undefined, read);
  }
  /** Distinct tag names in byte order. Names only: the owner reports no counts. Needs `thread.tags`. */
  threadTags(args: NamesArgs = {}, read?: ReadOptions): Promise<Outcome<Page<string>>> {
    return this.run("thread.tags", args, decodeNames, undefined, read);
  }
  /**
   * Distinct working directories. Shellboy `thread.cwds` mirrors
   * `thread.tags` (`{limit, cursor}` in, a page of strings out). This is the only place that says so.
   * Needs `thread.cwds`.
   */
  threadCwds(args: NamesArgs = {}, read?: ReadOptions): Promise<Outcome<Page<string>>> {
    return this.run("thread.cwds", args, decodeNames, undefined, read);
  }
  threadGet(threadId: string, read?: ReadOptions): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.get", { thread_id: threadId }, decodeDetails, undefined, read);
  }
  historyList(args: HistoryListArgs, read?: ReadOptions): Promise<Outcome<Page<HistoryItem>>> {
    return this.run("history.list", args, decodeHistoryPage, undefined, read);
  }
  historyWindow(args: HistoryWindowArgs, read?: ReadOptions): Promise<Outcome<HistoryWindowResult>> {
    return this.run("history.window", args, decodeHistoryWindow, undefined, read);
  }
  historyGet(args: HistoryGetArgs, read?: ReadOptions): Promise<Outcome<HistoryBody>> {
    return this.run("history.get", args, decodeBody, undefined, read);
  }
  shellList(args: ShellListArgs, read?: ReadOptions): Promise<Outcome<Page<ShellEntry>>> {
    return this.run("shell.list", args, decodeShellPage, undefined, read);
  }
  shellRead(args: ShellReadArgs, read?: ReadOptions): Promise<Outcome<ShellOutput>> {
    return this.run("shell.read", args, decodeShellOutput, undefined, read);
  }
  /** Saved usage totals, or one page of a grouped scan when `group_by` is set. No provider call. */
  usageGet(args: UsageGetArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("usage.get", args, decodeRecord, undefined, read);
  }
  /** Compaction observations of one Thread, newest first. */
  compactList(args: CompactListArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("compact.list", args, decodeRecord, undefined, read);
  }
  storageStatus(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("storage.status", {}, decodeRecord, undefined, read);
  }
  indexStatus(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("index.status", {}, decodeRecord, undefined, read);
  }
  /** `status --memory`: owner cache accounting and process memory, taken on request. */
  memoryStatus(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("status", { memory: true }, decodeRecord, undefined, read);
  }
  /** Activity status, for `receipt_budget`. One row is enough; the rows are not used. */
  threadWork(threadId: string, read?: ReadOptions): Promise<Outcome<Page<WorkItem>>> {
    return this.run("status", { thread_id: threadId, state: ["starting", "running", "stopping", "accepted", "held"], limit: 200 }, decodeWorkPage, undefined, read);
  }
  statusSummary(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("status", { limit: 1 }, decodeRecord, undefined, read);
  }
  /** Asks the connection's endpoint for its model list (one GET). No conversation request. */
  modelList(args: ModelListArgs = {}, read?: ReadOptions): Promise<Outcome<ModelListResult>> {
    return this.run("model.list", args, decodeModelList, undefined, read);
  }
  /** Update only model settings for this Thread; owner validates values. */
  setThreadModel(threadId: string, changes: { model: string; connection: string; effort?: string }): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, ...changes }, decodeDetails, { operationId: this.newId() });
  }
  /** One page of a Thread's family: ancestors, then breadth first. */
  threadBranches(args: ThreadBranchesArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.branches", args, decodeRecord, undefined, read);
  }
  /** `dry_run`: runs in a rolled-back savepoint and writes nothing, so it carries no operation id. */
  threadRewindPreview(args: ThreadRewindArgs): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.rewind", { ...args, dry_run: true }, decodeRecord);
  }
  /** The gateway's own process memory, as the OS reports it. */
  bridgeMemory(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("bridge.memory", {}, decodeRecord, undefined, read);
  }
  /** The gateway's own: apps found in the apps folder. Doesn't reach the owner. */
  appsList(): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.list", {}, decodeRecord);
  }
  appsInstances(name: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.instances", { name }, decodeRecord);
  }
  appsCreateInstance(name: string, instance: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.instance.create", { name, instance }, decodeRecord);
  }
  /** A one-time URL that opens an app on its own origin. */
  appsOpen(name: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.open", { name }, decodeRecord);
  }
  /** One API call from an app's page, for the app the caller named. */
  appsCall(name: string, op: string, args: unknown, read?: ReadOptions, instance?: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.call", { name, op, args, ...(instance ? { instance } : {}) }, decodeRecord, undefined, read);
  }
  /** Look up a mutation's receipt, e.g. after an `unconfirmed` error. */
  operationGet(operationId: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("operation.get", { operation_id: operationId }, decodeRecord);
  }

  // ---- mutations: pass `operationId` to retry the same logical mutation idempotently ----
  threadCreate(args: ThreadCreateArgs = {}, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.create", args, decodeDetails, { operationId });
  }
  /** Sender identity (`human`, `sender_label: "web"`) is set by the bridge, not here. */
  messageSend(args: MessageSendArgs, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("message.send", args, decodeRecord, { operationId });
  }
  messageReply(messageId: string, text: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("message.reply", { message_id: messageId, text }, decodeRecord, { operationId });
  }
  messageCancel(messageId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("message.cancel", { message_ids: [messageId] }, decodeRecord, { operationId });
  }
  runStop(runId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("run.stop", { run_id: runId }, decodeRecord, { operationId });
  }
  runRetry(runId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("run.retry", { run_id: runId }, decodeRecord, { operationId });
  }
  threadFork(args: ThreadForkArgs, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.fork", args, decodeDetails, { operationId });
  }
  /** `parent: ""` detaches. Needs an owner and bridge with the `thread.reparent` capability. */
  /** Needs an owner newer than v0.10.0; see `CAPABILITY_CONFIG`. */
  configGet(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("config.get", {}, decodeRecord, undefined, read);
  }
  /** Not cancellable: a started write finishes and is reported. A missing `value` removes the key. */
  configSet(expectedHash: string, changes: { field: string; value?: unknown }[], operationId = this.newId()): Promise<Outcome<Record<string, unknown>>> {
    return this.run("config.set", { expected_hash: expectedHash, changes }, decodeRecord, { operationId });
  }
  /** One model-list GET against a saved connection or a candidate. Needs the `connection.setup` capability. */
  connectionTest(target: TestTarget, read?: ReadOptions): Promise<Outcome<TestFacts>> {
    return this.run("connection.test", encodeTest(target), decodeTest, undefined, read);
  }
  /** Write-only. The value is sent once and never returned. */
  credentialsSet(connection: string, value: string, operationId = this.newId()): Promise<Outcome<StoredFacts>> {
    return this.run("credentials.set", encodeCredentialsSet(connection, value), decodeStored, { operationId });
  }
  credentialsClear(connection: string, operationId = this.newId()): Promise<Outcome<StoredFacts>> {
    return this.run("credentials.clear", encodeCredentialsClear(connection), decodeStored, { operationId });
  }
  threadSetTitle(threadId: string, title: string): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, title }, decodeDetails, { operationId: this.newId() });
  }
  threadSetParent(threadId: string, parent: string, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, parent_id: parent }, decodeDetails, { operationId });
  }
  /** Add and remove tags on several Threads at once. Needs `thread.tags`. */
  threadTag(args: ThreadTagArgs, operationId = this.newId()): Promise<Outcome<TagResult>> {
    return this.run("thread.tag", args, decodeTagResult, { operationId });
  }
  threadRewind(args: ThreadRewindArgs, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("thread.rewind", args, decodeRecord, { operationId });
  }
  threadUnarchive(
    threadIds: string[],
    options: { descendants?: boolean } = {},
    operationId = this.newId(),
  ): Promise<Outcome<ArchiveResult>> {
    const args: Record<string, unknown> = { thread_ids: threadIds };
    if (options.descendants) args.descendants = true;
    return this.run("thread.unarchive", args, decodeRecord, { operationId });
  }
  threadArchive(
    threadIds: string[],
    options: { descendants?: boolean } = {},
    operationId = this.newId(),
  ): Promise<Outcome<ArchiveResult>> {
    const args: Record<string, unknown> = { thread_ids: threadIds };
    if (options.descendants) args.descendants = true;
    return this.run("thread.archive", args, decodeRecord, { operationId });
  }
}
