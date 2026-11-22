import {HistoryWindowInput} from './history-input';
import {decodeHistoryWindow} from './history-decoder';
import {sanitizeMessageRelation,validHistoryProvenance} from './message-provenance';
import {captureDecode,InputCaptureError} from './immutable-input';
// Typed operations: the UX boundary for requests. Stateless wrappers over `Link.call`;
// they never touch the store (saved facts change only by re-reading after a hint).
import { decodeStored, decodeTest, encodeCredentialsClear, encodeCredentialsSet, encodeTest, type StoredFacts, type TestFacts, type TestTarget } from "./connection-setup";
import { fromApiError, lostConnection, type Outcome } from "./errors";
import type { Link } from "./link";
import type { ThreadDeletePreview } from "./thread-delete";
import type {
  CompactListArgs,
  HistoryBody,
  HistoryGetArgs,
  HistoryItem,
  HistoryWindowArgs,
  HistoryWindowResult,
  MessageSendArgs,
  MessageAccepted,
  AttachmentDetails,
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
  RunDetails,
  TurnDetails,
  RunState,
  TurnState,
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
const outcomeDecoder = <T>(decoder: Decoder<T>) => (raw: unknown): Outcome<T> => {
  try { const value=decoder(raw); return value.ok ? { ok:true, value:value.value } : { ok:false, error:{kind:'invalid_response',message:value.reason} }; }
  catch(error) { return { ok:false, error:{kind:'invalid_response',message:error instanceof InputCaptureError ? error.reason : 'invalid-input'} }; }
};

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

export const ATTACHMENT_PAGE_SIZE = 50;
export const CAPABILITY_ATTACHMENT_PAGE = "attachment.list.page";

function attachmentPage(threadId: string): Decoder<Page<AttachmentDetails>> {
  const decode = pageOf<AttachmentDetails>(row => !(isObject(row) && row.thread_id === threadId
    && typeof row.attachment_id === "string" && row.attachment_id.length > 0
    && typeof row.source_node_id === "string" && typeof row.delivery_status === "string"
    && typeof row.path === "string" && (row.kind === "file" || row.kind === "image")
    && typeof row.selected === "boolean" && typeof row.managed === "boolean"
    && (row.unavailable_reason === undefined || typeof row.unavailable_reason === "string"))
    ? "invalid attachment details" : undefined);
  return raw => {
    if (!isObject(raw) || !Array.isArray(raw.items) || raw.items.length > ATTACHMENT_PAGE_SIZE)
      return { ok: false, reason: "expected a bounded attachment page" };
    const page = decode(raw);
    if (page.ok && new Set(page.value.items.map(row => row.attachment_id)).size !== page.value.items.length)
      return { ok: false, reason: "duplicate attachment identity" };
    return page;
  };
}

const validEndMessage = (value: unknown): boolean => value == null
  || (isObject(value) && (value.node_id === null || typeof value.node_id === "string"));

const summaryProblem = (v: unknown): string | undefined =>
  !(isObject(v) && typeof v.thread_id === "string" && typeof v.title === "string" && typeof v.state === "string")
    ? "thread summary lacks thread_id, title or state"
    : v.tags !== undefined && !(Array.isArray(v.tags) && v.tags.every((t) => typeof t === "string"))
      ? "thread summary tags is not a list of strings"
      : !validEndMessage(v.last_end_message)
        ? "thread summary last_end_message is not an answer marker"
        : undefined;

const optionalNumber = (v: Record<string, unknown>, key: string): number | undefined => typeof v[key] === "number" ? v[key] as number : undefined;
const decodeThreadDeletePreview = (value: unknown): Decoded<ThreadDeletePreview> => {
  if (!isObject(value) || !isObject(value.selection) || !isObject(value.blockers)) return { ok: false, reason: "delete preview lacks selection or blockers" };
  const markerValue = value.preview_marker;
  const marker = isObject(markerValue) && typeof markerValue.thread_count === "number" && typeof markerValue.ids_hash === "string" ? { thread_count: markerValue.thread_count, ids_hash: markerValue.ids_hash } : undefined;
  const selection = value.selection;
  const blockers = value.blockers;
  return { ok: true, value: {
    selection: { thread_count: optionalNumber(selection, "thread_count"), descendant_thread_count: optionalNumber(selection, "descendant_thread_count"), surviving_descendant_thread_count: optionalNumber(selection, "surviving_descendant_thread_count") },
    blockers: { live_run_count: optionalNumber(blockers, "live_run_count"), stopping_run_count: optionalNumber(blockers, "stopping_run_count"), truncated: typeof blockers.truncated === "boolean" ? blockers.truncated : undefined },
    deletable_now: typeof value.deletable_now === "boolean" ? value.deletable_now : undefined,
    preview_marker: marker,
    preview_marker_unavailable_reason: typeof value.preview_marker_unavailable_reason === "string" ? value.preview_marker_unavailable_reason : undefined,
  } };
};

const decodeThreadPage = pageOf<ThreadSummary>(summaryProblem);
const decodeDetails: Decoder<ThreadDetails> = (v) =>
  isObject(v) && typeof v.thread_id === "string" && typeof v.title === "string"
    ? validEndMessage(v.last_end_message)
      ? { ok: true, value: v as ThreadDetails }
      : { ok: false, reason: "thread detail last_end_message is not an answer marker" }
    : { ok: false, reason: "thread.get result lacks thread_id or title" };
const runStates = new Set<RunState>(["live", "stopping", "stopped", "completed", "failed"]);
const turnStates = new Set<TurnState>(["preparing", "running", "waiting", "recovery_wait", "completed", "stopped", "failed"]);
const optionalString = (v: Record<string, unknown>, key: string): boolean => v[key] === undefined || typeof v[key] === "string";
const decodeRunDetails = (runId: string, threadId?: string): Decoder<RunDetails> => (v) =>
  isObject(v) && v.run_id === runId && typeof v.thread_id === "string" && (threadId === undefined || v.thread_id === threadId) && typeof v.state === "string" && runStates.has(v.state as RunState) && optionalString(v, "turn_id") && optionalString(v, "recovery_hint")
    ? { ok: true, value: v as RunDetails }
    : { ok: false, reason: "run.get result lacks the requested identity, state or optional field types" };
const decodeTurnDetails = (turnId: string, runId?: string, threadId?: string): Decoder<TurnDetails> => (v) =>
  isObject(v) && v.turn_id === turnId && (runId === undefined || v.run_id === runId) && typeof v.run_id === "string" && typeof v.thread_id === "string" && (threadId === undefined || v.thread_id === threadId) && typeof v.state === "string" && turnStates.has(v.state as TurnState) && optionalString(v, "recovery_hint")
    ? { ok: true, value: v as TurnDetails }
    : { ok: false, reason: "turn.get result does not match the requested identity or lacks state" };
const decodeShellPage = pageOf<ShellEntry>((v) =>
  isObject(v) && typeof v.execution_id === "string" && typeof v.state === "string"
    ? undefined
    : "shell entry lacks execution_id or state",
);
const workPage = pageOf<WorkItem>((v) =>
  isObject(v) && typeof v.kind === "string" && typeof v.id === "string" && typeof v.state === "string" && typeof v.thread_id === "string"
    ? undefined : "status item lacks kind, id, state or thread_id",
);
const decodeThreadWorkPage = (threadId: string): Decoder<Page<WorkItem>> => (v) => {
  const decoded = workPage(v);
  if (!decoded.ok) return decoded;
  if (decoded.value.items.length > 200) return { ok: false, reason: "status page exceeds 200 items" };
  if (decoded.value.items.some(item => item.thread_id !== threadId)) return { ok: false, reason: "status page contains a foreign Thread" };
  return decoded;
};
const decodeBody: Decoder<HistoryBody> = (v) => {
  if (!isObject(v) || typeof v.node_id !== 'string' || typeof v.text !== 'string') return { ok: false, reason: 'history.get result lacks node_id or text' };
  if (!validHistoryProvenance(v.provenance,v.kind)) return { ok: false, reason: 'history.get has invalid provenance identity' };
  if (Object.hasOwn(v, 'source_node_ids')) {
    const ids = v.source_node_ids;
    if (!Array.isArray(ids) || ids.length > 4096 || !ids.every(id => typeof id === 'string' && id.length > 0) || new Set(ids).size !== ids.length) return { ok: false, reason: 'history.get has invalid explicit source identities' };
  }
  return { ok: true, value: sanitizeMessageRelation(v as HistoryBody) };
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

export interface ProcessMetric {
  name: string;
  bytes: number | undefined;
  reason: string | undefined;
}

export interface CacheFact {
  name: string;
  retained: number | undefined;
  limit: number | undefined;
  entries: number | undefined;
  unit: string | undefined;
  live: number | undefined;
  pinned: number | undefined;
  reason: string | undefined;
}

export interface MemoryFacts {
  platform: string | undefined;
  observedAt: string | undefined;
  /** Metrics this platform provides; the rest carry a reason and are left out. */
  metrics: ProcessMetric[];
  caches: CacheFact[];
  accounting: string | undefined;
}

const decodeMemoryStatus: Decoder<MemoryFacts> = value => {
  const numberOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
  const stringOrNull = (v: unknown) => v === null || typeof v === "string";
  const fields = (record: Record<string, unknown>, requiredNumbers: readonly string[], requiredStrings: readonly string[], optionalNumbers: readonly string[] = [], optionalStrings: readonly string[] = []) =>
    requiredNumbers.every(key => Object.hasOwn(record, key) && numberOrNull(record[key]))
      && requiredStrings.every(key => Object.hasOwn(record, key) && stringOrNull(record[key]))
      && optionalNumbers.every(key => !Object.hasOwn(record, key) || numberOrNull(record[key]))
      && optionalStrings.every(key => !Object.hasOwn(record, key) || stringOrNull(record[key]));
  if (!isObject(value) || !isObject(value.caches) || !isObject(value.process) || !isObject(value.process.metrics))
    return { ok: false, reason: "status --memory result lacks caches or process metrics" };
  if (!Object.hasOwn(value, "accounting") || !stringOrNull(value.accounting)
    || !fields(value.process, [], ["platform", "observed_at"]))
    return { ok: false, reason: "status --memory metadata has an invalid type" };
  if (Object.values(value.caches).some(cache => !isObject(cache)
    || !fields(cache, ["retained_bytes", "limit_bytes", "entries"], ["unavailable_reason"], ["live_bytes", "live_encoded_bytes", "pinned_bytes"], ["entry_unit"])))
    return { ok: false, reason: "status --memory cache entry has an invalid field type" };
  if (Object.values(value.process.metrics).some(metric => !isObject(metric)
    || !fields(metric, ["bytes"], ["unavailable_reason"])))
    return { ok: false, reason: "status --memory process metric has an invalid field type" };
  // The fields above are qualified once, at the wire boundary.
  const cache = Object.entries(value.caches) as [string, Record<string, number | string | null>][];
  const metrics = Object.entries(value.process.metrics) as [string, {bytes: number | null; unavailable_reason: string | null}][];
  return { ok: true, value: {
    platform: (value.process.platform as string | null) ?? undefined,
    observedAt: (value.process.observed_at as string | null) ?? undefined,
    accounting: (value.accounting as string | null) ?? undefined,
    metrics: metrics.flatMap(([name, item]) => item.bytes === null && item.unavailable_reason === "Not provided on this platform" ? []
      : [{ name, bytes: item.bytes ?? undefined, reason: item.unavailable_reason ?? undefined }]),
    caches: cache.map(([name, c]) => ({ name, retained: (c.retained_bytes as number | null) ?? undefined,
      limit: (c.limit_bytes as number | null) ?? undefined, entries: (c.entries as number | null) ?? undefined,
      unit: (c.entry_unit as string | null) ?? undefined, live: ((c.live_bytes ?? c.live_encoded_bytes) as number | null) ?? undefined,
      pinned: (c.pinned_bytes as number | null) ?? undefined, reason: (c.unavailable_reason as string | null) ?? undefined })),
  } };
};

export type MemoryReadIssue = "unsupported" | "invalid_response" | "disconnected" | "owner_busy";
export function memoryReadIssue(error: import("./errors").OpError | undefined): MemoryReadIssue | undefined {
  if (lostConnection(error) || (error?.kind === "owner" && error.code === "app_not_running")) return "disconnected";
  if (!error) return undefined;
  if (error.kind === "invalid_response") return "invalid_response";
  if (error.kind !== "owner") return undefined;
  const details = isObject(error.details) ? error.details : undefined;
  if (error.code === "invalid_state" && details?.phase === "admission" && details.request_may_have_been_applied === false) return "owner_busy";
  // Protocol-6 rejects an unsupported memory field as typed invalid_argument, not a made-up operation code.
  if (error.code === "invalid_argument" && details?.reason === "unknown_field" && details.name === "memory" && details.command === "status") return "unsupported";
  return undefined;
}

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
  descendants?: boolean;
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

function unwrap<T>(response: OwnerResponse, decode: (raw: unknown) => Outcome<T>): Outcome<T> {
  if (!response.ok) return response.error ? { ok:false,error:fromApiError(response.error) } : { ok:false,error:{kind:'invalid_response',message:'owner error without error body'} };
  if (response.result === undefined) return { ok:false,error:{kind:'invalid_response',message:'owner reply without result'} };
  return decode(response.result);
}

export class Operations {
  constructor(
    private readonly link: Link,
    private readonly newId: UuidFn,
    private readonly historyWindowSupported: () => boolean = () => false,
  ) {}

  /** Reserve a receipt before publishing an in-flight model attempt. */
  mutationId(): string { return this.newId(); }

  private async run<T>(
    command: string,
    args: unknown,
    decode: (raw: unknown) => Outcome<T>,
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
    return this.run("thread.list", args, outcomeDecoder(decodeThreadPage), undefined, read);
  }
  /** Distinct tag names in byte order. Names only: the owner reports no counts. Needs `thread.tags`. */
  threadTags(args: NamesArgs = {}, read?: ReadOptions): Promise<Outcome<Page<string>>> {
    return this.run("thread.tags", args, outcomeDecoder(decodeNames), undefined, read);
  }
  /**
   * Distinct working directories. Shellboy `thread.cwds` mirrors
   * `thread.tags` (`{limit, cursor}` in, a page of strings out). This is the only place that says so.
   * Needs `thread.cwds`.
   */
  threadCwds(args: NamesArgs = {}, read?: ReadOptions): Promise<Outcome<Page<string>>> {
    return this.run("thread.cwds", args, outcomeDecoder(decodeNames), undefined, read);
  }
  attachmentList(threadId: string, cursor?: string, read?: ReadOptions): Promise<Outcome<Page<AttachmentDetails>>> {
    return this.run("attachment.list", { thread_id: threadId, limit: ATTACHMENT_PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) }, outcomeDecoder(attachmentPage(threadId)), undefined, read);
  }
  threadGet(threadId: string, read?: ReadOptions): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.get", { thread_id: threadId }, outcomeDecoder(decodeDetails), undefined, read);
  }
  runGet(runId: string, identity?: { threadId?: string }, read?: ReadOptions): Promise<Outcome<RunDetails>> {
    return this.run("run.get", { run_id: runId }, outcomeDecoder(decodeRunDetails(runId, identity?.threadId)), undefined, read);
  }
  turnGet(turnId: string, identity?: { runId?: string; threadId?: string }, read?: ReadOptions): Promise<Outcome<TurnDetails>> {
    return this.run("turn.get", { turn_id: turnId }, outcomeDecoder(decodeTurnDetails(turnId, identity?.runId, identity?.threadId)), undefined, read);
  }
  historyWindow(args: HistoryWindowArgs, read?: ReadOptions): Promise<Outcome<HistoryWindowInput>> {
    if (!this.historyWindowSupported()) return Promise.resolve({ ok: false, error: { kind: "invalid_response", message: "owner does not advertise history.window" } });
    return this.run<HistoryWindowInput>("history.window", args, raw => HistoryWindowInput.decode(raw), undefined, read);
  }
  historyGet(args: HistoryGetArgs, read?: ReadOptions): Promise<Outcome<HistoryBody>> {
    return this.run("history.get", args, outcomeDecoder(decodeBody), undefined, read);
  }
  shellList(args: ShellListArgs, read?: ReadOptions): Promise<Outcome<Page<ShellEntry>>> {
    return this.run("shell.list", args, outcomeDecoder(decodeShellPage), undefined, read);
  }
  shellRead(args: ShellReadArgs, read?: ReadOptions): Promise<Outcome<ShellOutput>> {
    return this.run("shell.read", args, outcomeDecoder(decodeShellOutput), undefined, read);
  }
  /** Saved usage totals, or one page of a grouped scan when `group_by` is set. No provider call. */
  usageGet(args: UsageGetArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("usage.get", args, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** Compaction observations of one Thread, newest first. */
  compactList(args: CompactListArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("compact.list", args, outcomeDecoder(decodeRecord), undefined, read);
  }
  storageStatus(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("storage.status", {}, outcomeDecoder(decodeRecord), undefined, read);
  }
  indexStatus(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("index.status", {}, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** `status --memory`: request-scoped cache/process facts; no separate capability is advertised. */
  memoryStatus(read?: ReadOptions): Promise<Outcome<MemoryFacts>> {
    return this.run("status", { memory: true }, outcomeDecoder(decodeMemoryStatus), undefined, read);
  }
  /** Activity status, for `receipt_budget`. One row is enough; the rows are not used. */
  handoffAttempts(threadId: string, read?: ReadOptions): Promise<Outcome<Page<WorkItem>>> {
    const decode=decodeThreadWorkPage(threadId);
    const owned=(raw:unknown)=>captureDecode(raw,(value)=>{const out=decode(value);if(!out.ok)throw new InputCaptureError('invalid-input');
      Object.freeze(out.value.items); for(const item of out.value.items){if(item.response_nodes)Object.freeze(item.response_nodes);Object.freeze(item);} Object.freeze(out.value); return out.value;});
    return this.run("status", { thread_id: threadId, all: true, limit: 200 }, owned, undefined, read);
  }
  threadWork(threadId: string, read?: ReadOptions): Promise<Outcome<Page<WorkItem>>> {
    const decode=decodeThreadWorkPage(threadId);
    const owned=(raw:unknown)=>captureDecode(raw,(value)=>{const out=decode(value);if(!out.ok)throw new InputCaptureError('invalid-input');
      Object.freeze(out.value.items); for(const item of out.value.items){if(item.response_nodes)Object.freeze(item.response_nodes);Object.freeze(item);} Object.freeze(out.value); return out.value;});
    return this.run("status", { thread_id: threadId, state: ["starting", "running", "stopping", "accepted", "held"], limit: 200 }, owned, undefined, read);
  }
  statusSummary(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("status", { limit: 1 }, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** Asks the connection's endpoint for its model list (one GET). No conversation request. */
  modelList(args: ModelListArgs = {}, read?: ReadOptions): Promise<Outcome<ModelListResult>> {
    return this.run("model.list", args, outcomeDecoder(decodeModelList), undefined, read);
  }
  /** Update only model settings for this Thread; owner validates values. */
  setThreadModel(threadId: string, changes: { model: string; connection: string; effort?: string; agents?: string; auto_compact_at?: string; max_tokens?: string }): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, ...changes }, outcomeDecoder(decodeDetails), { operationId: this.newId() });
  }
  /** One page of a Thread's family: ancestors, then breadth first. */
  threadBranches(args: ThreadBranchesArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.branches", args, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** `dry_run`: runs in a rolled-back savepoint and writes nothing, so it carries no operation id. */
  threadRewindPreview(args: ThreadRewindArgs, read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.rewind", { ...args, dry_run: true }, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** The gateway's own process memory, as the OS reports it. */
  bridgeMemory(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("bridge.memory", {}, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** The gateway's own: apps found in the apps folder. Doesn't reach the owner. */
  appsList(): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.list", {}, outcomeDecoder(decodeRecord));
  }
  appsInstances(name: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.instances", { name }, outcomeDecoder(decodeRecord));
  }
  appsCreateInstance(name: string, instance: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.instance.create", { name, instance }, outcomeDecoder(decodeRecord));
  }
  /** A one-time URL that opens an app on its own origin. */
  appsOpen(name: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.open", { name }, outcomeDecoder(decodeRecord));
  }
  /** One API call from an app's page, for the app the caller named. */
  appsCall(name: string, op: string, args: unknown, read?: ReadOptions, instance?: string): Promise<Outcome<Record<string, unknown>>> {
    return this.run("apps.call", { name, op, args, ...(instance ? { instance } : {}) }, outcomeDecoder(decodeRecord), undefined, read);
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
    return this.run("operation.get", { operation_id: operationId }, outcomeDecoder(decodeRecord));
  }

  // ---- mutations: pass `operationId` to retry the same logical mutation idempotently ----
  threadCreate(args: ThreadCreateArgs = {}, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.create", args, outcomeDecoder(decodeDetails), { operationId });
  }
  /** Sender identity (`human`, `sender_label: "web"`) is set by the bridge, not here. */
  messageSend(args: MessageSendArgs, operationId = this.newId()): Promise<Outcome<MessageAccepted>> {
    return this.run("message.send", args, outcomeDecoder(decodeMessageAccepted), { operationId });
  }
  messageReply(messageId: string, text: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("message.reply", { message_id: messageId, text }, outcomeDecoder(decodeRecord), { operationId });
  }
  messageCancel(messageId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("message.cancel", { message_ids: [messageId] }, outcomeDecoder(decodeRecord), { operationId });
  }
  runStop(runId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("run.stop", { run_id: runId }, outcomeDecoder(decodeRecord), { operationId });
  }
  runRetry(runId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("run.retry", { run_id: runId }, outcomeDecoder(decodeRecord), { operationId });
  }
  threadFork(args: ThreadForkArgs, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.fork", args, outcomeDecoder(decodeDetails), { operationId });
  }
  /** `parent: ""` detaches. Needs an owner and bridge with the `thread.reparent` capability. */
  /** Needs an owner newer than v0.10.0; see `CAPABILITY_CONFIG`. */
  configGet(read?: ReadOptions): Promise<Outcome<Record<string, unknown>>> {
    return this.run("config.get", {}, outcomeDecoder(decodeRecord), undefined, read);
  }
  /** Not cancellable: a started write finishes and is reported. A missing `value` removes the key. */
  configSet(expectedHash: string, changes: { field: string; value?: unknown }[], operationId = this.newId()): Promise<Outcome<Record<string, unknown>>> {
    return this.run("config.set", { expected_hash: expectedHash, changes }, outcomeDecoder(decodeRecord), { operationId });
  }
  /** One model-list GET against a saved connection or a candidate. Needs the `connection.setup` capability. */
  connectionTest(target: TestTarget, read?: ReadOptions): Promise<Outcome<TestFacts>> {
    return this.run("connection.test", encodeTest(target), outcomeDecoder(decodeTest), undefined, read);
  }
  /** Write-only. The value is sent once and never returned. */
  credentialsSet(connection: string, value: string, operationId = this.newId()): Promise<Outcome<StoredFacts>> {
    return this.run("credentials.set", encodeCredentialsSet(connection, value), outcomeDecoder(decodeStored), { operationId });
  }
  credentialsClear(connection: string, operationId = this.newId()): Promise<Outcome<StoredFacts>> {
    return this.run("credentials.clear", encodeCredentialsClear(connection), outcomeDecoder(decodeStored), { operationId });
  }
  threadSetTitle(threadId: string, title: string, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, title }, outcomeDecoder(decodeDetails), { operationId });
  }
  threadSetParent(threadId: string, parent: string, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.set", { thread_id: threadId, parent_id: parent }, outcomeDecoder(decodeDetails), { operationId });
  }
  /** Add and remove tags on several Threads at once. Needs `thread.tags`. */
  threadTag(args: ThreadTagArgs, operationId = this.newId()): Promise<Outcome<TagResult>> {
    return this.run("thread.tag", args, outcomeDecoder(decodeTagResult), { operationId });
  }
  threadRewind(args: ThreadRewindArgs, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("thread.rewind", args, outcomeDecoder(decodeRecord), { operationId });
  }
  threadUnarchive(
    threadIds: string[],
    options: { descendants?: boolean } = {},
    operationId = this.newId(),
  ): Promise<Outcome<ArchiveResult>> {
    const args: Record<string, unknown> = { thread_ids: threadIds };
    if (options.descendants) args.descendants = true;
    return this.run("thread.unarchive", args, outcomeDecoder(decodeRecord), { operationId });
  }
  threadDeletePreview(threadId: string): Promise<Outcome<ThreadDeletePreview>> {
    return this.run("thread.delete_preview", { thread_id: threadId, descendants: false }, outcomeDecoder(decodeThreadDeletePreview));
  }
  threadDelete(threadId: string, previewMarker: { thread_count: number; ids_hash: string }, operationId = this.newId()): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.delete", { thread_id: threadId, descendants: false, preview_marker: previewMarker }, outcomeDecoder(decodeRecord), { operationId });
  }

  threadArchive(
    threadIds: string[],
    options: { descendants?: boolean } = {},
    operationId = this.newId(),
  ): Promise<Outcome<ArchiveResult>> {
    const args: Record<string, unknown> = { thread_ids: threadIds };
    if (options.descendants) args.descendants = true;
    return this.run("thread.archive", args, outcomeDecoder(decodeRecord), { operationId });
  }
}
