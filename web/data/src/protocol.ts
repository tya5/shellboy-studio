// Wire types of the bridge's /ws envelope (src/envelope.rs) and the owner payloads the
// data layer reads. Hand-written until Shellboy publishes a JSON Schema (#244 D); every
// owner record keeps an index signature so fields added by the owner pass through.

export interface ApiError {
  code: string;
  message: string;
  hint?: string;
  details?: unknown;
}

export interface OwnerInfo {
  protocol_version: number;
  instance_id: string | null;
  capabilities: string[];
}

export type OwnerState = { state: "connected"; info: OwnerInfo } | { state: "unreachable" };

export type OwnerEvent = "connected" | "unreachable" | "restarted";

export interface BridgeError {
  code: string;
  message: string;
  owner_error?: ApiError;
}

/** Owner `Response<Value>` passed through verbatim by the bridge. */
export interface OwnerResponse {
  protocol_version: number;
  operation_id: string;
  ok: boolean;
  result?: unknown;
  error?: ApiError;
}

export type ClientFrame =
  | { t: "call"; id: number; command: string; args?: unknown; operation_id?: string }
  | { t: "watch"; thread_ids: string[]; list: boolean }
  | { t: "cancel"; id: number };

export type ServerFrame =
  | { t: "hello"; bridge_version: string; data_dir?: string; owner: OwnerState }
  | { t: "result"; id: number; response?: OwnerResponse; error?: BridgeError }
  | { t: "changed"; thread_ids: string[]; list: boolean }
  | { t: "stream"; thread_id: string; cursor: string; text: string; gap: boolean }
  | { t: "resync" }
  | { t: "owner"; event: OwnerEvent; owner: OwnerState }
  | { t: "error"; error: BridgeError };

export type ParsedFrame = { ok: true; frame: ServerFrame } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function validOwnerState(v: unknown): v is OwnerState {
  if (!isObject(v)) return false;
  if (v.state === "unreachable") return true;
  return v.state === "connected" && isObject(v.info) && typeof v.info.protocol_version === "number";
}

/** Strict enough to keep the state machine honest; unknown `t` is reported, not guessed. */
export function parseServerFrame(text: string): ParsedFrame {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  if (!isObject(v) || typeof v.t !== "string") return { ok: false, reason: "missing t" };
  const bad = (why: string): ParsedFrame => ({ ok: false, reason: `${v.t} frame: ${why}` });
  switch (v.t) {
    case "hello":
      if (typeof v.bridge_version !== "string" || !validOwnerState(v.owner)) return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "result":
      if (typeof v.id !== "number" || (!isObject(v.response) && !isObject(v.error)))
        return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "changed":
      if (!isStrings(v.thread_ids) || typeof v.list !== "boolean") return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "stream":
      if (
        typeof v.thread_id !== "string" ||
        typeof v.cursor !== "string" ||
        typeof v.text !== "string" ||
        typeof v.gap !== "boolean"
      )
        return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "resync":
      return { ok: true, frame: { t: "resync" } };
    case "owner":
      if (
        (v.event !== "connected" && v.event !== "unreachable" && v.event !== "restarted") ||
        !validOwnerState(v.owner)
      )
        return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "error":
      if (!isObject(v.error) || typeof v.error.code !== "string") return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    default:
      return { ok: false, reason: `unknown frame ${String(v.t)}` };
  }
}

// ---- Owner records (Shellboy protocol 2 at the pinned revision) ----

export interface Page<T> {
  items: T[];
  next_cursor?: string;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  cwd: string;
  state: string;
  /** Owner activity phase word, e.g. idle, tools, retrying. Not recomputed here. */
  activity: string;
  updated_at: string;
  excerpt: string;
  parent_id?: string;
  archived_at?: string;
  /** Sorted; absent when the Thread has none, and on an owner without tags. */
  tags?: string[];
  latest_run_stop_reason?: string | null;
  [extra: string]: unknown;
}

export interface ThreadDetails {
  thread_id: string;
  title: string;
  cwd: string;
  connection: string;
  model: string;
  run_id?: string;
  turn_id?: string;
  parent_id?: string;
  archived_at?: string;
  tags?: string[];
  children_count: number;
  shells_count: number;
  [extra: string]: unknown;
}

/** A shell execution linked from a history node (`history.list`, observed at the pinned revision). */
export interface HistoryExecution {
  execution_id: string;
  command_excerpt?: string;
  command_truncated?: boolean;
  /** Saved native shell state: starting, running, stopping, exited, failed, stopped. */
  state?: string;
  call_state?: string;
  cwd?: string;
  [extra: string]: unknown;
}

/**
 * One `history.list` item. The owner does not type these fields yet (#244 follow-up), so they
 * are optional here and readers tolerate their absence; added fields pass through.
 */
export interface HistoryItem {
  node_id?: string;
  /** user, assistant_response, tool_result, event, context, summary, ... */
  kind?: string;
  excerpt?: string;
  execution_count?: number;
  executions?: HistoryExecution[];
  provenance?: { created_at?: string; sender?: { kind?: string; [extra: string]: unknown }; [extra: string]: unknown };
  /** Position on the Thread's selected path; `ordinal` ascends. */
  selection?: { ordinal?: number; [extra: string]: unknown };
  [extra: string]: unknown;
}

/** `history.get` page of one node's body. */
export interface HistoryBody {
  node_id: string;
  kind: string;
  text: string;
  next_cursor?: string;
  [extra: string]: unknown;
}

/** One `shell.list` item (saved facts of one execution). */
export interface ShellEntry {
  execution_id: string;
  state: string;
  thread_id?: string;
  run_id?: string;
  command_excerpt?: string;
  command_excerpt_truncated?: boolean;
  started_at?: string;
  ended_at?: string;
  exit_code?: number | null;
  [extra: string]: unknown;
}

/** `usage.get` arguments the UI uses. The owner rejects a grouped period over 31 days. */
export interface UsageGetArgs {
  group_by?: "day" | "hour" | "thread";
  /** `local`, `UTC` or a fixed `+HH:MM`/`-HH:MM`. */
  timezone?: string;
  since?: string;
  until?: string;
  thread_id?: string;
  limit?: number;
  cursor?: string;
}

export interface CompactListArgs {
  thread_id: string;
  since?: string;
  until?: string;
  /** 1 to 200. */
  limit: number;
}

export interface ThreadBranchesArgs {
  thread_id: string;
  /** 1 to 200. */
  limit?: number;
  cursor?: string;
}

export interface ThreadForkArgs {
  thread_id: string;
  node_id: string;
}

export interface ThreadRewindArgs {
  thread_id: string;
  node_id: string;
}

export interface ModelListArgs {
  connection?: string;
  thread_id?: string;
}

export interface ModelListResult {
  connection: string;
  models: string[];
  api?: string;
  unavailable_features?: string[];
  [extra: string]: unknown;
}

/** `shell.read` page. `cursor` continues after this page; `output_complete` ends it. */
export interface ShellOutput {
  execution_id: string;
  text: string;
  cursor?: string;
  output_complete: boolean;
  [extra: string]: unknown;
}

export type ArchivedFilter = "exclude" | "include" | "only";
export type Deliver = "next" | "now";

export interface ThreadListArgs {
  limit?: number;
  cursor?: string;
  query?: string;
  archived?: ArchivedFilter;
  /** Needs the `thread.tags` capability. Every tag must match (AND); at most 64. */
  tags?: string[];
  /** Needs the `thread.cwds` capability. Exact, after the owner's own cleanup; an absolute path. */
  cwd?: string;
}

/** A page of names for `thread.tags` and `thread.cwds`. */
export interface NamesArgs {
  limit?: number;
  cursor?: string;
}
export interface ThreadTagArgs {
  thread_ids: string[];
  add?: string[];
  remove?: string[];
}
export interface TagResult {
  changed: string[];
  unchanged: string[];
  not_found: string[];
  add: string[];
  remove: string[];
  [extra: string]: unknown;
}
export interface HistoryListArgs {
  thread_id: string;
  limit?: number;
  cursor?: string;
  excerpt_chars?: number;
  /** Inclusive node creation time (RFC3339 with offset). */
  since?: string;
}
/** `history.window` (Shellboy #268, capability `history.window`): a positional window of the selected path. */
export interface HistoryWindowArgs {
  thread_id: string;
  /** With neither `ordinal` nor `node_id` the window ends at the last node. */
  ordinal?: number;
  node_id?: string;
  /** With `ordinal`: `cursor_expired` unless this node still sits there. */
  expect_node_id?: string;
  before?: number;
  after?: number;
  excerpt_chars?: number;
}
export interface HistoryWindowResult {
  thread_id: string;
  /** Advances on append, rewind and compaction. */
  revision: string | number;
  /** One past the last ordinal. */
  total: number;
  /** `history.list` items, ascending; `selection.ordinal` is the position. */
  items: HistoryItem[];
}
export interface HistoryGetArgs {
  node_id: string;
  cursor?: string;
  limit_bytes?: number;
}
export interface ShellListArgs {
  thread_id: string;
  limit?: number;
}
export interface ShellReadArgs {
  execution_id: string;
  cursor?: string;
  limit_bytes?: number;
}
export interface ThreadCreateArgs {
  cwd?: string;
  parent_id?: string;
}
export interface MessageSendArgs {
  thread_id: string;
  text: string;
  deliver?: Deliver;
}
