// Owner resource facts from `status --memory`, `storage.status`, `index.status` and `status`.
// A value the owner doesn't report stays absent, with the owner's reason where it gives one.
const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export interface StorageFacts {
  liveBytes: number | undefined;
  categories: { name: "history" | "raw" | "index" | "managed"; bytes: number | undefined }[];
  dbBytes: number | undefined;
  walBytes: number | undefined;
  managedFileBytes: number | undefined;
  logBytes: number | undefined;
  reclaimableBytes: number | undefined;
  reclaimableIsLowerBound: boolean;
  reusableBytes: number | undefined;
  /** Absent when the owner can't read it. */
  freeBytes: number | undefined;
  warning: boolean;
  limitReached: boolean;
}

export function readStorage(v: Record<string, unknown>): StorageFacts {
  return {
    liveBytes: num(v.logical_live_bytes),
    categories: [
      { name: "history", bytes: num(v.logical_history_bytes) },
      { name: "raw", bytes: num(v.logical_raw_bytes) },
      { name: "index", bytes: num(v.logical_index_bytes) },
      { name: "managed", bytes: num(v.logical_managed_bytes) },
    ],
    dbBytes: num(v.db_bytes),
    walBytes: num(v.wal_bytes),
    managedFileBytes: num(v.managed_bytes),
    logBytes: num(v.log_bytes),
    reclaimableBytes: num(v.reclaimable_bytes),
    reclaimableIsLowerBound: v.reclaimable_is_lower_bound === true,
    reusableBytes: num(v.database_reusable_bytes),
    freeBytes: num(v.filesystem_free_bytes),
    warning: v.warning === true,
    limitReached: v.limit_reached === true,
  };
}

export interface IndexSpace {
  id: string;
  connection: string | undefined;
  model: string | undefined;
  dimension: number | undefined;
  segments: number | undefined;
  vectorBytes: number | undefined;
  state: string | undefined;
  selected: boolean;
}

export interface IndexFacts {
  autoHistory: boolean;
  held: number | undefined;
  pending: number | undefined;
  running: number | undefined;
  done: number | undefined;
  failed: number | undefined;
  paused: boolean;
  /** The owner's own sentence, e.g. embedding not configured. */
  reason: string | undefined;
  spaces: IndexSpace[];
  spacesTotal: number;
  truncated: boolean;
}

export function readIndex(v: Record<string, unknown>): IndexFacts {
  const spaces = Array.isArray(v.spaces) ? v.spaces : [];
  return {
    autoHistory: v.auto_history === true,
    held: num(v.held_auto_history),
    pending: num(v.pending),
    running: num(v.running),
    done: num(v.done),
    failed: num(v.failed),
    paused: v.paused === true,
    reason: str(v.reason),
    spaces: spaces.flatMap((s): IndexSpace[] => {
      const o = obj(s);
      const id = str(o?.space_id);
      if (!o || !id) return [];
      return [{ id, connection: str(o.connection), model: str(o.model), dimension: num(o.dimension), segments: num(o.segments), vectorBytes: num(o.vector_payload_bytes), state: str(o.state), selected: o.selected === true }];
    }),
    spacesTotal: num(v.spaces_total) ?? spaces.length,
    truncated: v.spaces_truncated === true,
  };
}

export interface ReceiptFacts {
  accounted: number | undefined;
  limit: number | undefined;
  atLimit: boolean;
  retentionSeconds: number | undefined;
}

export function readReceipts(v: Record<string, unknown>): ReceiptFacts | undefined {
  const b = obj(v.receipt_budget);
  if (!b) return undefined;
  return { accounted: num(b.accounted_bytes), limit: num(b.limit_bytes), atLimit: b.at_limit === true, retentionSeconds: num(b.result_retention_seconds) };
}

// ---- one Thread's settings, from `thread.get` ----

export type OutputLimitReadback = { readonly kind: "unset" } | { readonly kind: "value"; readonly value: number } | { readonly kind: "unknown" };

export interface ThreadSettings {
  connection: string | undefined;
  model: string | undefined;
  effort: string | undefined;
  cwd: string | undefined;
  agentsPath: string | undefined;
  /** This Thread's own value; undefined when it follows the connection or `[compaction]`. */
  autoCompactAt: number | undefined;
  effectiveAutoCompactAt: number | undefined;
  autoCompactTargetPercent: number | undefined;
  effectiveAutoCompactTargetPercent: number | undefined;
  summaryMaxChars: number | undefined;
  effectiveSummaryMaxChars: number | undefined;
  spill: boolean | undefined;
  effectiveSpill: boolean | undefined;
  maxTokensState: OutputLimitReadback;
  effectiveMaxTokensState: OutputLimitReadback;
  maxTokens: number | undefined;
  effectiveMaxTokens: number | undefined;
}

function outputLimit(v: unknown): OutputLimitReadback {
  if (v === undefined || v === null) return { kind: "unset" };
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? { kind: "value", value: v } : { kind: "unknown" };
}

export function readThreadSettings(d: Record<string, unknown>): ThreadSettings {
  const own = outputLimit(d.max_tokens);
  const effective = outputLimit(d.effective_max_tokens);
  return {
    connection: str(d.connection),
    model: str(d.model),
    effort: str(d.effort),
    cwd: str(d.cwd),
    agentsPath: str(d.agents_path),
    autoCompactAt: num(d.auto_compact_at),
    effectiveAutoCompactAt: num(d.effective_auto_compact_at),
    autoCompactTargetPercent: num(d.auto_compact_target_percent),
    effectiveAutoCompactTargetPercent: num(d.effective_auto_compact_target_percent),
    summaryMaxChars: num(d.summary_max_chars),
    effectiveSummaryMaxChars: num(d.effective_summary_max_chars),
    spill: typeof d.spill === "boolean" ? d.spill : undefined,
    effectiveSpill: typeof d.effective_spill === "boolean" ? d.effective_spill : undefined,
    maxTokensState: own,
    effectiveMaxTokensState: effective,
    maxTokens: own.kind === "value" ? own.value : undefined,
    effectiveMaxTokens: effective.kind === "value" ? effective.value : undefined,
  };
}

/**
 * `config.toml` keys Settings shows. An owner older than `config.get` (#266) can't read them. Where each
 * one sits, and how it's edited, is `CONFIG_FIELDS` in `config.ts`.
 */
export type ConfigKey =
  | "default_connection"
  | "default_model"
  | "ui.language"
  | "embedding.connection"
  | "embedding.model"
  | "indexing.auto_history"
  | "indexing.auto_kinds"
  | "limits.disk_free_min_bytes"
  | "limits.attachment_file_bytes"
  | "limits.attachment_request_bytes"
  | "limits.shell_raw_bytes"
  | "limits.tool_excerpt_bytes"
  | "limits.shell_stdin_bytes"
  | "limits.draft_bytes"
  | "connections.default_effort"
  | "connections.base_url"
  | "connections.api_key_env"
  | "connections.ssl_verify"
  | "connections.timeouts"
  | "embedding.batch_max_inputs"
  | "embedding.batch_max_chars"
  | "indexing.split_chars"
  | "indexing.concurrency"
  | "shell.kind"
  | "shell.executable"
  | "shell.env"
  | "limits.data_warning_bytes"
  | "limits.data_max_bytes"
  | "retention.tool_raw_days"
  | "retention.tool_raw_bytes"
  | "retention.clipboard_days"
  | "retention.clipboard_bytes"
  | "compaction.summary_max_chars"
  | "compaction.auto_at_tokens";
