import {sanitizeMessageRelation} from "./message-provenance";
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
  MessageAccepted,
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
const rawHistoryPage = pageOf<HistoryItem>((v) => (isObject(v) ? undefined : "history item is not an object"));
// Core942 protocol1611-1616 / spill_tools.rs: bounded public metadata only.
function validSpillTools(value: unknown): boolean {
  if (value === null) return true;
  if (!isObject(value) || typeof value.status !== 'string' || typeof value.truncated !== 'boolean' || !Array.isArray(value.items) || value.items.length > 8) return false;
  const encoder = new TextEncoder();
  const optionalId = (id: unknown) => id === undefined || id === null || (typeof id === 'string' && encoder.encode(id).length <= 256);
  if (!value.items.every(item => isObject(item) && typeof item.call_id === 'string' && item.call_id.length > 0 && encoder.encode(item.call_id).length <= 256 && optionalId(item.execution_id) && optionalId(item.original_node_id))) return false;
  // Duplicate/conflicting public tuples are valid wire facts, not authority to merge tools.
  return encoder.encode(JSON.stringify(value)).length <= 16384;
}
const decodeHistoryPage: Decoder<Page<HistoryItem>> = value => {
 const result=rawHistoryPage(value);
 return result.ok?{ok:true,value:{...result.value,items:result.value.items.map(sanitizeMessageRelation)}}:result;
};
const historyItemReasons = new Set(['source_budget', 'response_budget', 'legacy', 'pruned', 'opaque', 'unsupported']);
function validToolDescriptor(value: unknown, result: boolean): value is Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).some(key => !['call_id', 'call_id_state', 'name', 'name_state'].includes(key))) return false;
  const states: readonly unknown[] = ['available', 'missing', 'invalid', 'field_budget', 'not_applicable'];
  if (!states.includes(value.call_id_state) || !states.includes(value.name_state) || value.call_id_state === 'not_applicable') return false;
  if (result ? value.name_state !== 'not_applicable' : value.name_state === 'not_applicable') return false;
  for (const [key, state] of [['call_id', value.call_id_state], ['name', value.name_state]] as const) {
    const field = value[key];
    if (state === 'available') {
      if (typeof field !== 'string' || !field || new TextEncoder().encode(field).length > 256) return false;
      if (key === 'name' && /[^\x21-\x7e]/.test(field)) return false;
    } else if (Object.hasOwn(value, key)) return false;
  }
  return true;
}
const decodeHistoryWindow: Decoder<HistoryWindowResult> = (v) => {
  const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (!isObject(v) || !Array.isArray(v.items) || v.items.length > 200 || !Number.isSafeInteger(v.total) || (v.total as number) < 0 || !(typeof v.revision === 'string' || typeof v.revision === 'number')) return bad('invalid history.window envelope');
  if (v.items.some(node => isObject(node) && Object.hasOwn(node, 'spill_tools') && !validSpillTools(node.spill_tools))) return bad('invalid public spill identities');
  if (!v.items.some(node => isObject(node) && (Object.hasOwn(node, 'items') || Object.hasOwn(node, 'items_unavailable_reason')))) return { ok: true, value: {...v,items:(v.items as unknown as HistoryItem[]).map(sanitizeMessageRelation)} as unknown as HistoryWindowResult };
  let bytes = 0; let deferred = false; let previous = -1;
  const encoder = new TextEncoder();
  for (const node of v.items) {
    if (!isObject(node) || !isObject(node.selection) || !Number.isSafeInteger(node.selection.ordinal) || (node.selection.ordinal as number) < 0 || (node.selection.ordinal as number) <= previous) return bad('invalid history node ordinal');
    previous = node.selection.ordinal as number;
    if (!Object.hasOwn(node, 'items')) {
      if (Object.hasOwn(node, 'items_unavailable_reason') || deferred) return bad('missing deferred projection');
      continue; // Honest legacy compatibility, without synthesizing text from excerpts.
    }
    if (node.items === null) {
      if (typeof node.node_id !== 'string' || !node.node_id) return bad('invalid deferred node identity');
      if (node.items_unavailable_reason !== 'response_budget') return bad('null projection requires response_budget');
      deferred = true; continue;
    }
    if (deferred || !Array.isArray(node.items) || Object.hasOwn(node, 'items_unavailable_reason') || typeof node.node_id !== 'string' || !node.node_id) return bad('invalid whole-node item projection');
    const ids = new Set<string>();
    for (const item of node.items) {
      if (!isObject(item) || typeof item.item_identity !== 'string' || !item.item_identity || ids.has(item.item_identity)) return bad('invalid or duplicate saved item identity');
      ids.add(item.item_identity);
      let allowed: string[];
      switch (item.kind) {
        case 'text': {
          allowed = ['kind', 'item_identity', 'text', 'text_complete'];
          if (typeof item.text !== 'string' || typeof item.text_complete !== 'boolean') return bad('invalid authoritative text');
          const length = encoder.encode(item.text).length; bytes += length;
          if (length > 16384 || bytes > 4194304) return bad('history item text budget exceeded');
          break;
        }
        case 'tool_call': case 'tool_result':
          allowed = ['kind', 'item_identity', 'execution_ids', 'descriptor', 'detail_availability'];
          if (!Array.isArray(item.execution_ids) || item.execution_ids.length > 8 || !item.execution_ids.every(id => typeof id === 'string' && id.length > 0)) return bad('invalid execution identities');
          if (Object.hasOwn(item, 'descriptor') !== Object.hasOwn(item, 'detail_availability')) return bad('partial tool metadata');
          if (Object.hasOwn(item, 'descriptor')) {
            if (!validToolDescriptor(item.descriptor, item.kind === 'tool_result')) return bad('invalid tool descriptor');
            if (item.detail_availability !== 'execution_linked' && item.detail_availability !== 'unavailable') return bad('invalid tool detail availability');
            if ((item.detail_availability === 'execution_linked') !== (item.execution_ids.length > 0)) return bad('inconsistent tool routing');
            bytes += encoder.encode(typeof item.descriptor.call_id === 'string' ? item.descriptor.call_id : '').length
              + encoder.encode(typeof item.descriptor.name === 'string' ? item.descriptor.name : '').length;
            if (bytes > 4194304) return bad('history item metadata budget exceeded');
          }
          break;
        case 'reasoning_unavailable': allowed = ['kind', 'item_identity']; break;
        case 'unavailable':
          allowed = ['kind', 'item_identity', 'reason'];
          if (typeof item.reason !== 'string' || !historyItemReasons.has(item.reason)) return bad('invalid unavailable reason');
          break;
        default: return bad('unknown history item kind');
      }
      if (Object.keys(item).some(key => !allowed.includes(key))) return bad('unexpected saved item field');
    }
  }
  return { ok: true, value: {...v,items:(v.items as unknown as HistoryItem[]).map(sanitizeMessageRelation)} as unknown as HistoryWindowResult };
};
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
const decodeBody: Decoder<HistoryBody> = (v) => {
  if (!isObject(v) || typeof v.node_id !== 'string' || typeof v.text !== 'string') return { ok: false, reason: 'history.get result lacks node_id or text' };
  if (Object.hasOwn(v, 'source_node_ids')) {
    const ids = v.source_node_ids;
    if (!Array.isArray(ids) || ids.length > 4096 || !ids.every(id => typeof id === 'string' && id.length > 0) || new Set(ids).size !== ids.length) return { ok: false, reason: 'history.get has invalid explicit source identities' };
  }
  return { ok: true, value: v as HistoryBody };
};
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

const decodeMessageAccepted: Decoder<MessageAccepted> = value =>
  isObject(value) && typeof value.message_id === "string" && value.message_id.length > 0
    && typeof value.thread_id === "string" && value.thread_id.length > 0
    ? { ok: true, value: value as MessageAccepted }
    : { ok: false, reason: "expected MessageAccepted with nonempty message_id and thread_id" };

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

  /** Reserve a receipt before publishing an in-flight model attempt. */
  mutationId(): string { return this.newId(); }

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
  handoffAttempts(threadId: string, read?: ReadOptions): Promise<Outcome<Page<WorkItem>>> {
    return this.run("status", { thread_id: threadId, all: true, limit: 200 }, decodeWorkPage, undefined, read);
  }
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
  setThreadModel(threadId: string, changes: { model: string; connection: string; effort?: string; agents?: string; auto_compact_at?: string; segment_chars?: string; reduce_rounds?: string }): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, ...changes }, decodeDetails, { operationId: this.newId() });
  }
  /** One page of a Thread's family: ancestors, then breadth first. */
  threadBranches(args: ThreadBranchesArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.branches", args, decodeRecord, undefined, read);
  }
  /** `dry_run`: runs in a rolled-back savepoint and writes nothing, so it carries no operation id. */
  threadRewindPreview(args: ThreadRewindArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.rewind", { ...args, dry_run: true }, decodeRecord, undefined, read);
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
  /** Opaque saved outcomes are diagnostic only, never mutation acknowledgments. */
  async branchReceipt(operationId: string): Promise<Outcome<unknown>> {
    const found = await this.operationGet(operationId);
    if (!found.ok) return { ...found, operationId };
    const v = found.value;
    const known = v.operation_id === operationId && ["completed", "failed", "pending"].includes(String(v.state)) &&
      ["return_saved_outcome", "do_not_reexecute"].includes(String(v.replay_policy));
    return { ok: false, error: { kind: "invalid_response", message: known ? "Opaque original receipt remains unconfirmed" : "Receipt identity, state or policy is invalid" }, operationId };
  }
  operationGet(operationId: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("operation.get", { operation_id: operationId }, decodeRecord);
  }

  // ---- mutations: pass `operationId` to retry the same logical mutation idempotently ----
  threadCreate(args: ThreadCreateArgs = {}, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.create", args, decodeDetails, { operationId });
  }
  /** Sender identity (`human`, `sender_label: "web"`) is set by the bridge, not here. */
  messageSend(args: MessageSendArgs, operationId = this.newId()): Promise<Outcome<MessageAccepted>> {
    return this.run("message.send", args, decodeMessageAccepted, { operationId });
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
  threadSetTitle(threadId: string, title: string, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, title }, decodeDetails, { operationId });
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
