// Typed operations: the UX boundary for requests. Stateless wrappers over `Link.call`;
// they never touch the store (saved facts change only by re-reading after a hint).
import { fromApiError, type Outcome } from "./errors";
import type { Link } from "./link";
import type {
  CompactListArgs,
  HistoryBody,
  HistoryGetArgs,
  HistoryItem,
  HistoryListArgs,
  MessageSendArgs,
  ModelListArgs,
  ModelListResult,
  OwnerResponse,
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
  UsageGetArgs,
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
  isObject(v) && typeof v.thread_id === "string" && typeof v.title === "string" && typeof v.state === "string"
    ? undefined
    : "thread summary lacks thread_id, title or state";

const decodeThreadPage = pageOf<ThreadSummary>(summaryProblem);
const decodeHistoryPage = pageOf<HistoryItem>((v) => (isObject(v) ? undefined : "history item is not an object"));
const decodeDetails: Decoder<ThreadDetails> = (v) =>
  isObject(v) && typeof v.thread_id === "string" && typeof v.title === "string"
    ? { ok: true, value: v as ThreadDetails }
    : { ok: false, reason: "thread.get result lacks thread_id or title" };
const decodeShellPage = pageOf<ShellEntry>((v) =>
  isObject(v) && typeof v.execution_id === "string" && typeof v.state === "string"
    ? undefined
    : "shell entry lacks execution_id or state",
);
const decodeBody: Decoder<HistoryBody> = (v) =>
  isObject(v) && typeof v.node_id === "string" && typeof v.text === "string"
    ? { ok: true, value: v as HistoryBody }
    : { ok: false, reason: "history.get result lacks node_id or text" };
const decodeShellOutput: Decoder<ShellOutput> = (v) =>
  isObject(v) && typeof v.execution_id === "string" && typeof v.text === "string"
    ? { ok: true, value: v as ShellOutput }
    : { ok: false, reason: "shell.read result lacks execution_id or text" };
const decodeRecord: Decoder<Record<string, unknown>> = (v) =>
  isObject(v) ? { ok: true, value: v } : { ok: false, reason: "expected an object result" };

const decodeModelList: Decoder<ModelListResult> = (v) =>
  isObject(v) && typeof v.connection === "string" && Array.isArray(v.models)
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

/** Hooks for reads issued by the store; presentation does not need them. */
export interface ReadOptions {
  onSent?: () => void;
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
    const handle = this.link.call(
      command,
      args,
      mutation ? { operationId: mutation.operationId, mutation: true } : { ...read },
    );
    const reply = await handle.promise;
    const extra = mutation ? { operationId: mutation.operationId } : {};
    if (!reply.ok) return { ok: false, error: reply.error, ...extra };
    return { ...unwrap(reply.response, decode), ...extra };
  }

  // ---- reads ----
  threadList(args: ThreadListArgs = {}, read?: ReadOptions): Promise<Outcome<Page<ThreadSummary>>> {
    return this.run("thread.list", args, decodeThreadPage, undefined, read);
  }
  threadGet(threadId: string, read?: ReadOptions): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.get", { thread_id: threadId }, decodeDetails, undefined, read);
  }
  historyList(args: HistoryListArgs, read?: ReadOptions): Promise<Outcome<Page<HistoryItem>>> {
    return this.run("history.list", args, decodeHistoryPage, undefined, read);
  }
  historyGet(args: HistoryGetArgs): Promise<Outcome<HistoryBody>> {
    return this.run("history.get", args, decodeBody);
  }
  shellList(args: ShellListArgs): Promise<Outcome<Page<ShellEntry>>> {
    return this.run("shell.list", args, decodeShellPage);
  }
  shellRead(args: ShellReadArgs): Promise<Outcome<ShellOutput>> {
    return this.run("shell.read", args, decodeShellOutput);
  }
  /** Saved usage totals, or one page of a grouped scan when `group_by` is set. No provider call. */
  usageGet(args: UsageGetArgs): Promise<Outcome<Record<string, unknown>>> {
    return this.run("usage.get", args, decodeRecord);
  }
  /** Compaction observations of one Thread, newest first. */
  compactList(args: CompactListArgs): Promise<Outcome<Record<string, unknown>>> {
    return this.run("compact.list", args, decodeRecord);
  }
  storageStatus(): Promise<Outcome<Record<string, unknown>>> {
    return this.run("storage.status", {}, decodeRecord);
  }
  indexStatus(): Promise<Outcome<Record<string, unknown>>> {
    return this.run("index.status", {}, decodeRecord);
  }
  /** `status --memory`: owner cache accounting and process memory, taken on request. */
  memoryStatus(): Promise<Outcome<Record<string, unknown>>> {
    return this.run("status", { memory: true }, decodeRecord);
  }
  /** Activity status, for `receipt_budget`. One row is enough; the rows are not used. */
  statusSummary(): Promise<Outcome<Record<string, unknown>>> {
    return this.run("status", { limit: 1 }, decodeRecord);
  }
  /** Asks the connection's endpoint for its model list (one GET). No conversation request. */
  modelList(args: ModelListArgs = {}): Promise<Outcome<ModelListResult>> {
    return this.run("model.list", args, decodeModelList);
  }
  /** One page of a Thread's family: ancestors, then breadth first. */
  threadBranches(args: ThreadBranchesArgs): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.branches", args, decodeRecord);
  }
  /** `dry_run`: runs in a rolled-back savepoint and writes nothing, so it carries no operation id. */
  threadRewindPreview(args: ThreadRewindArgs): Promise<Outcome<Record<string, unknown>>> {
    return this.run("thread.rewind", { ...args, dry_run: true }, decodeRecord);
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
  runStop(runId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("run.stop", { run_id: runId }, decodeRecord, { operationId });
  }
  runRetry(runId: string, operationId = this.newId()): Promise<Outcome<MutationResult>> {
    return this.run("run.retry", { run_id: runId }, decodeRecord, { operationId });
  }
  threadFork(args: ThreadForkArgs, operationId = this.newId()): Promise<Outcome<ThreadDetails>> {
    return this.run("thread.fork", args, decodeDetails, { operationId });
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
