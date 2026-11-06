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
  | { t: "hello"; bridge_version: string; owner: OwnerState }
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
  children_count: number;
  shells_count: number;
  [extra: string]: unknown;
}

/** One `history.list` item. Its fields are not typed by the owner yet; kept opaque. */
export type HistoryItem = Record<string, unknown>;

export type ArchivedFilter = "exclude" | "include" | "only";
export type Deliver = "next" | "now";

export interface ThreadListArgs {
  limit?: number;
  cursor?: string;
  query?: string;
  archived?: ArchivedFilter;
}
export interface HistoryListArgs {
  thread_id: string;
  limit?: number;
  cursor?: string;
  excerpt_chars?: number;
}
export interface MessageSendArgs {
  thread_id: string;
  text: string;
  deliver?: Deliver;
}
