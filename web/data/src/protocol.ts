import type { ArtifactScopeFilter, CompactListFilters } from "./record-pages";

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

export const STARTUP_STAGES = ["configuration", "owner_lock", "database", "database_pragmas", "database_migration", "database_validate", "database_foreign_keys", "database_quick_check", "interrupted_work", "control", "endpoint", "closing"] as const;
export type StartupStage = typeof STARTUP_STAGES[number];
const launcherPhases = ["starting", "running", "stopping", "stopped", "exited", "failed", "external"] as const;
export interface LauncherState {
  phase: typeof launcherPhases[number];
  instance_id: string | null;
  ready_at_ms: number | null;
  automatic_restart_available: boolean;
  restarted_after: string | null;
  failure: string | null;
}
export type LauncherAction = "start" | "stop" | "restart" | "exit";

export type ClientFrame =
  | { t: "call"; id: number; command: string; args?: unknown; operation_id?: string }
  | { t: "watch"; thread_ids: string[]; list: boolean }
  | { t: "cancel"; id: number }
  | { t: "launcher"; action: LauncherAction; instance_id?: string };

export type ServerFrame =
  | { t: "hello"; bridge_version: string; listen?: string; data_dir?: string; owner: OwnerState; desktop?: boolean; core_management?: boolean }
  | { t: "result"; id: number; response?: OwnerResponse; error?: BridgeError }
  | { t: "changed"; thread_ids: string[]; list: boolean; config_changed: boolean }
  | { t: "live"; thread_id: string; attempt_id: string; input_through_node_id?: string | null; gap: boolean; deltas: { offset: number; reasoning: boolean; text: string }[] }
  | { t: "attempt_end"; thread_id: string; attempt_id: string; outcome: "adopted" | "not_adopted"; output_limit?: AttemptOutputLimit | null; seq: number }
  | { t: "live_end"; thread_id: string }
  | { t: "resync" }
  | { t: "owner"; event: OwnerEvent; owner: OwnerState }
  | { t: "error"; error: BridgeError }
  | { t: "launcher_state"; state: LauncherState }
  | { t: "startup_stage"; stage: StartupStage | null }
  | { t: "launcher_diagnostic"; message: string | null };

export type ParsedFrame = { ok: true; frame: ServerFrame } | { ok: false; reason: string; code?: "frame_too_large" };

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
/** Client resource policy for ALL incoming frame kinds, not a Core method guarantee. */
export const MAX_SERVER_FRAME_BYTES = 8388660;
/** Fixed auxiliary memory; mirrors UTF8 replacement for isolated surrogates. */
export function exceedsServerFrameBytes(text: string): boolean {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit <= 0x7f) bytes++;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > MAX_SERVER_FRAME_BYTES) return true;
  }
  return false;
}

export function parseServerFrame(text: string): ParsedFrame {
  if (exceedsServerFrameBytes(text)) return { ok: false, reason: "frame too large", code: "frame_too_large" };
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
      if (!isStrings(v.thread_ids) || typeof v.list !== "boolean" || typeof v.config_changed !== "boolean") return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "live":
      if (
        typeof v.thread_id !== "string" ||
        typeof v.attempt_id !== "string" ||
        (v.input_through_node_id != null && typeof v.input_through_node_id !== "string") ||
        typeof v.gap !== "boolean" ||
        !Array.isArray(v.deltas) ||
        !v.deltas.every(
          (d) => isObject(d) && Number.isSafeInteger(d.offset) && typeof d.reasoning === "boolean" && typeof d.text === "string",
        )
      )
        return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "attempt_end":
      if (typeof v.thread_id !== "string" || typeof v.attempt_id !== "string"
        || (v.outcome !== "adopted" && v.outcome !== "not_adopted") || !Number.isSafeInteger(v.seq)
        || (v.output_limit !== undefined && v.output_limit !== null && !validAttemptOutputLimit(v.output_limit))) return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "live_end":
      if (typeof v.thread_id !== "string") return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "resync":
      return { ok: true, frame: { t: "resync" } };
    case "launcher_state": {
      const state = v.state;
      if (!isObject(state) || !launcherPhases.some(phase => phase === state.phase)
        || ![state.instance_id, state.restarted_after, state.failure].every(x => x === null || typeof x === "string")
        || !(state.ready_at_ms === null || Number.isSafeInteger(state.ready_at_ms))
        || typeof state.automatic_restart_available !== "boolean") return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    }
    case "startup_stage":
      if (v.stage !== null && !STARTUP_STAGES.some(stage => stage === v.stage)) return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
    case "launcher_diagnostic":
      if (v.message !== null && typeof v.message !== "string") return bad("bad fields");
      return { ok: true, frame: v as unknown as ServerFrame };
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

// ---- Owner records (protocol-5 candidate; release pin validation is separate) ----

export interface Page<T, Filters = unknown> {
  items: T[];
  next_cursor?: string;
  limit?: number;
  filters?: Filters;
}

export interface CompactListResult extends Record<string, unknown> {
  items: unknown[];
  limit: number;
  filters: CompactListFilters;
  more: boolean;
  period: unknown;
  coverage: unknown;
}

/** Core #316 metadata. URIs are opaque here; this layer never opens them. */
export interface ArtifactVersionStamp {
  version: number;
  created_at: string;
}
export interface ArtifactVersion extends ArtifactVersionStamp {
  uri: string;
  title: string;
  mime: string | null;
}
interface ArtifactIdentity {
  artifact_id: string;
  thread_id: string;
  created_at: string;
  updated_at: string;
}
export interface ArtifactSummary extends ArtifactIdentity {
  latest: ArtifactVersion;
}
export interface ArtifactHistory extends ArtifactSummary {
  versions: Page<ArtifactVersionStamp, ArtifactScopeFilter>;
}
export interface ArtifactSelected extends ArtifactIdentity {
  version: ArtifactVersion;
}

/** Core #327, selected attachment metadata; this surface never reads file bytes. */
export interface AttachmentDetails {
  source_node_id: string;
  delivery_status: string;
  attachment_id: string;
  thread_id: string;
  path: string;
  kind: "file" | "image";
  selected: boolean;
  managed: boolean;
  unavailable_reason?: string;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  cwd: string;
  state: string;
  /** Owner activity phase word, e.g. idle, tools, retrying. Not recomputed here. */
  activity: string;
  updated_at: string;
  created_at?: string | null;
  excerpt: string;
  parent_thread_id?: string;
  archived_at?: string;
  /** Sorted; absent when the Thread has none, and on an owner without tags. */
  tags?: string[];
  /** Latest completed answer node, from the existing list row. */
  last_end_message?: EndMessageMarker | null;
  latest_run_stop_reason?: string | null;
  awaiting_named_count?: number;
  /** False makes the reported count a lower bound. */
  awaiting_named_count_exact: boolean;
  awaiting_named_oldest_at?: string | null;
  awaiting_thread_count?: number;
  /** False means the total count was truncated to a lower bound. */
  awaiting_replies_count_exact: boolean;
  /** False means the Thread-directed count was truncated to a lower bound. */
  awaiting_thread_count_exact: boolean;
  /** False means the excerpt scan stopped before older selected history. */
  excerpt_complete?: boolean;
  [extra: string]: unknown;
}

export interface ReplyCount { count: number; exact: boolean }
export interface AwaitingOwnAsk { message_id: string; blocking_message_id: string }
export interface ReplySender {
  kind: "model" | "external_cli" | "human" | "unknown";
  thread_id?: string;
  label?: string;
}
export type ReplyDirection = { owed_by: string } | { asked_by: string } | { to: string };
export interface PendingReply {
  message_id: string;
  created_at: string;
  asked_by: string | null;
  sender: ReplySender;
  recipient: { kind: "name"; name: string } | { kind: "thread"; thread_id: string };
  excerpt: string;
}

/** A stop settlement failed and the Run is still `stopping`; cleared on successful settlement. */
export type RunStopSettlementFailure = "storage" | "invariant";

export interface EndMessageMarker { node_id: string | null }

export interface ThreadDetails {
  summarizing?: boolean;
  last_end_message?: EndMessageMarker | null;
  max_tokens?: number | null;
  effective_max_tokens?: number;
  auto_compact_at?: number | null;
  effective_auto_compact_at?: number;
  auto_compact_target_percent?: number | null;
  effective_auto_compact_target_percent?: number;
  summary_max_chars?: number | null;
  effective_summary_max_chars?: number;
  spill?: boolean | null;
  effective_spill?: boolean;
  effort?: string;
  agents_path?: string;
  thread_id: string;
  title: string;
  cwd: string;
  connection: string;
  model: string;
  run_id?: string;
  turn_id?: string;
  parent_thread_id?: string;
  archived_at?: string;
  tags?: string[];
  shells_count: number;
  /** `awaiting_own_ask` (protocol 43) lists owed duties held open by this Thread's own ask; omitted when empty. */
  pending_replies?: { owed_by: ReplyCount; asked_by: ReplyCount; awaiting_own_ask?: AwaitingOwnAsk[] };
  [extra: string]: unknown;
}

/** One bounded status observation; it does not contain message text or shell commands. */
export interface ResponseNodeRef { ordinal: number; item_id?: string | null; kind: string; phase?: string | null; node_id: string }

export interface WorkItem {
  thread_title?: string;
  attempt_id?: string | null;
  turn_id?: string | null;
  response_nodes?: ResponseNodeRef[];
  response_nodes_truncated?: boolean;
  kind: string;
  id: string;
  state: string;
  thread_id: string;
  run_id?: string | null;
  execution_id?: string | null;
  message_id?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  /** Bounded history.read preview, absent when it could not be read. */
  excerpt?: string;
  /** Run items (protocol 44): the same saved fact run.get returns; Core includes it only while that Run is stopping. */
  stop_settlement_failure?: RunStopSettlementFailure | null;
}

/** A shell execution linked from a history node (`history.window`, observed at the pinned revision). */
export interface HistoryExecution {
  execution_id: string;
  command_excerpt?: string;
  command_truncated?: boolean;
  /** The model's one-line account of the call. Newer owners only. */
  description?: string;
  /** Saved native shell state: starting, running, stopping, exited, failed, stopped. */
  state?: string;
  call_state?: string;
  cwd?: string;
  [extra: string]: unknown;
}

/**
 * One selected-path history node. The owner does not type these fields yet (#244 follow-up), so they
 * are optional here and readers tolerate their absence; added fields pass through.
 */
/** Local rendering qualification; never serialized into an owner RPC. */
export interface AssistantPublication { state: "unknown" | "tool" | "message"; attemptId?: string; ordinal?: number; kind?: string; error?: boolean }
/** Core296 DTO source: 00328ddf660fdbeecaf383cf078107bd32983209; opt-in only. */
export type HistoryItemsUnavailableReason = 'source_budget' | 'response_budget' | 'legacy' | 'pruned' | 'opaque' | 'unsupported';
// Optional only for compatibility with installed owners preceding Core #298.
export type ToolFieldAvailability = 'available' | 'missing' | 'invalid' | 'field_budget' | 'not_applicable';
export interface ToolDescriptor {
  readonly call_id?: string;
  readonly call_id_state: ToolFieldAvailability;
  readonly name?: string;
  readonly name_state: ToolFieldAvailability;
}
export type ToolDetailAvailability = 'execution_linked' | 'unavailable';

export type HistorySavedItem =
  | { readonly kind: 'text'; readonly item_identity: string; readonly text: string; readonly text_complete: boolean }
  | { readonly kind: 'tool_call' | 'tool_result'; readonly item_identity: string; readonly execution_ids: readonly string[]; readonly descriptor?: ToolDescriptor; readonly detail_availability?: ToolDetailAvailability }
  | { readonly kind: 'reasoning_unavailable'; readonly item_identity: string }
  | { readonly kind: 'unavailable'; readonly item_identity: string; readonly reason: HistoryItemsUnavailableReason };
/** Existing Core942 public spill-local identities; no tool payload/detail fields. */
export interface SpillToolSource {
  readonly call_id: string;
  readonly execution_id?: string | null;
  readonly original_node_id?: string | null;
}
export interface SpillToolSources {
  readonly status: string;
  readonly items: readonly SpillToolSource[];
  readonly truncated: boolean;
}
/** Public Core302 structure only; never inferred from notification body text. */
export type NotificationDescriptor =
  | { kind: 'turn_started' }
  | { kind: 'recovery_resumed' }
  | { kind: 'instructions_observed'; observation: 'first_seen' | 'updated' | 'removed' }
  | { kind: 'thread_settings_changed'; changed_fields: ('cwd' | 'connection' | 'model' | 'effort')[] }
  | { kind: 'shell_ended'; execution_id: string; state: 'exited' | 'failed' | 'stopped'; exit_code?: number };

export type MessageProvenance =
  | {expect_reply:false;reply_to?:string}
  | {expect_reply:true;reply_state:'pending'|'awaiting_own_ask'|'ignored'|'cancelled';reply_node_id?:never}
  | {expect_reply:true;reply_state:'replied';reply_node_id:string};

export type AttemptId = string & { readonly __attemptId: unique symbol };

export interface HistoryItem {
  spill_tools?: SpillToolSources | null;
  /** Absent on legacy owners/reads; null is a deferred whole node, never prose. */
  items?: readonly HistorySavedItem[] | null;
  items_unavailable_reason?: HistoryItemsUnavailableReason;
  /** Client-owned, carried only within the already bounded retained history window. */
  assistant_publication?: AssistantPublication;
  node_id?: string;
  /** user, assistant_response, tool_result, event, context, summary, ... */
  kind?: string;
  excerpt?: string;
  excerpt_omitted?: boolean;
  excerpt_truncated?: boolean;
  execution_count?: number;
  /** Absent on legacy owners; false means execution_count is a lower bound. */
  execution_count_exact?: boolean;
  executions?: HistoryExecution[];
  provenance?: { client_operation_id?: string; attempt_id?: AttemptId; notification?: NotificationDescriptor; message?: MessageProvenance; created_at?: string; output_limit?: SavedOutputLimit; sender?: { kind?: string; [extra: string]: unknown }; [extra: string]: unknown };
  /** Position on the Thread's selected path; `ordinal` ascends. */
  selection?: { ordinal?: number; [extra: string]: unknown };
  [extra: string]: unknown;
}

/** `history.read` page of one node's body. */
export interface HistoryBody {
  /** Same optional admitted provenance as list/window; older absence stays unknown. */
  provenance?: HistoryItem['provenance'];
  /** Explicit replacement sources; absent on older owners, empty is not coverage. */
  source_node_ids?: readonly string[];
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
  run_id?: string | null;
  command_excerpt?: string;
  command_excerpt_truncated?: boolean;
  turn_id?: string;
  started_at?: string;
  ended_at?: string;
  exit_code?: number | null;
  /** Running items only: the current Turn waits on exactly this execution. Not used by the UI yet. */
  foreground?: boolean | null;
  [extra: string]: unknown;
}

/** `usage.get` arguments the UI uses. The owner rejects a grouped period over 31 days. */
export interface UsageGetArgs {
  /** Saved node timestamp, inclusive; mutually exclusive with since. Not an ordinal cut. */
  since_node_id?: string;
  group_by?: "day" | "hour" | "thread" | "model";
  /** `local`, `UTC` or a fixed `+HH:MM`/`-HH:MM`. */
  timezone?: string;
  since?: string;
  until?: string;
  thread_id?: string;
  limit?: number;
  cursor?: string;
}

export interface SavedOutputLimit {
  readonly stop: true;
  readonly sent_max_tokens?: number | null;
  readonly source?: AttemptOutputLimit["source"];
  readonly connection?: string;
}

export interface AttemptOutputLimit {
  stop: boolean;
  sent_max_tokens?: number | null;
  source?: "thread_override" | "connection" | "default" | "extra_body" | null;
  connection: string;
}

function validAttemptOutputLimit(value: unknown): value is AttemptOutputLimit {
  if (!isObject(value) || typeof value.stop !== "boolean" || typeof value.connection !== "string") return false;
  if (value.sent_max_tokens !== undefined && value.sent_max_tokens !== null
    && (!Number.isSafeInteger(value.sent_max_tokens) || (value.sent_max_tokens as number) < 0)) return false;
  return value.source === undefined || value.source === null
    || ["thread_override", "connection", "default", "extra_body"].includes(String(value.source));
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

export type OperationReplayPolicy = "do_not_reexecute" | "operation_expired" | "return_saved_outcome";
export type OperationReceiptDownstream =
  | { kind: "message"; state: string; hold_reason?: string | null }
  | { kind: "compact"; state: string; outcome?: unknown; ended_at?: string | null; result_uncertain?: boolean | null };
export interface OperationReceiptDetails {
  operation_id: string;
  instance_id: string;
  created_at: string;
  current_instance: boolean;
  state: string;
  outcome: unknown | null;
  result_uncertain: boolean;
  result_expired: boolean;
  replay_policy: OperationReplayPolicy;
  targets: Record<string, string>;
  downstream?: OperationReceiptDownstream | null;
}

export type WaitCondition =
  | { type: "message_delivered"; message_id: string }
  | { type: "reply_received"; message_id: string }
  | { type: "thread_settled"; thread_ids: string[]; states: string[] }
  | { type: "run_ended"; run_id: string }
  | { type: "turn_completed"; turn_id: string }
  | { type: "shell_ended"; execution_id: string }
  | { type: "shell_output"; execution_id: string; cursor: string };
export interface WaitResult {
  status: "satisfied" | "timeout" | "interrupted" | "recovery_wait" | "unavailable";
  matched: unknown[];
  snapshot?: unknown;
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

/** Offsets in Studio's decoded string, not Core's wire byte offsets. */
export interface StderrRange { start: number; end: number }

/** `shell.read` page. `cursor` continues after this page; `output_complete` ends it. */
export interface ShellOutput {
  execution_id: string;
  text: string;
  stderr?: readonly StderrRange[];
  cursor?: string;
  output_complete: boolean;
  [extra: string]: unknown;
}

export type ArchivedFilter = "exclude" | "include" | "only";
export type Deliver = "next" | "complete";

export interface ThreadListArgs {
  /** Return exact summaries without paging. */
  thread_ids?: string[];
  order?: "updated" | "created";
  /** Current derived row state; requires updated order. */
  state?: "idle" | "live" | "stopping" | "preparing" | "running" | "waiting" | "recovery_wait" | "completed" | "stopped" | "failed";
  awaiting?: "human";
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
/** Character budget used by bounded positional history.window reads. */
export const HISTORY_WINDOW_EXCERPT_CHARS = 4096;
export interface HistoryWindowArgs {
  items?: boolean;
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
  revision: number;
  /** One past the last ordinal. */
  total: number;
  /** selected-path items, ascending; `selection.ordinal` is the position. */
  items: HistoryItem[];
}
export interface HistoryReadArgs {
  end_message_only?: boolean;
  parts?: boolean;
  encoding?: string;
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
  segments?: boolean;
  /** Read the final retained page without requiring a cursor. Not yet used by Studio. */
  tail?: boolean;
  cursor?: string;
  limit_bytes?: number;
}
export interface ThreadCreateArgs {
  cwd?: string;
  parent_thread_id?: string;
}
/** Wire acceptance for message.send and message.ask; the canonical node ID is message_id. */
export interface MessageAccepted {
  message_id: string;
  thread_id: string;
  [key: string]: unknown;
}
/** Pinned message.ask result schema; the browser bridge still denies Ask. */
export type MessageAskResult = MessageAccepted;
/** Public message.reply result; routed acceptance is nested and may be absent. */
export interface MessageReplied {
  message_id: string;
  reply_to: string;
  delivery?: MessageAccepted;
  [key: string]: unknown;
}

export interface MessageSendArgs {
  thread_id: string;
  text: string;
  deliver?: Deliver;
}
