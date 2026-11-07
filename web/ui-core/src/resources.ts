// Owner resource facts from `status --memory`, `storage.status`, `index.status` and `status`.
// A value the owner doesn't report stays absent, with the owner's reason where it gives one.
const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

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

export function readMemory(v: Record<string, unknown>): MemoryFacts {
  const process = obj(v.process) ?? {};
  const metrics = obj(process.metrics) ?? {};
  const caches = obj(v.caches) ?? {};
  return {
    platform: str(process.platform),
    observedAt: str(process.observed_at),
    metrics: Object.entries(metrics)
      .map(([name, m]) => ({ name, bytes: num(obj(m)?.bytes), reason: str(obj(m)?.unavailable_reason) }))
      .filter((m) => m.bytes !== undefined || m.reason !== "Not provided on this platform"),
    caches: Object.entries(caches).map(([name, c]) => {
      const o = obj(c) ?? {};
      return {
        name,
        retained: num(o.retained_bytes),
        limit: num(o.limit_bytes),
        entries: num(o.entries),
        unit: str(o.entry_unit),
        live: num(o.live_bytes) ?? num(o.live_encoded_bytes),
        pinned: num(o.pinned_bytes),
        reason: str(o.unavailable_reason),
      };
    }),
    accounting: str(v.accounting),
  };
}

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

export interface ThreadSettings {
  connection: string | undefined;
  model: string | undefined;
  effort: string | undefined;
  cwd: string | undefined;
  agentsPath: string | undefined;
  /** This Thread's own value; undefined when it follows the connection or `[compaction]`. */
  autoCompactAt: number | undefined;
  effectiveAutoCompactAt: number | undefined;
  segmentChars: number | undefined;
  effectiveSegmentChars: number | undefined;
  reduceRounds: number | undefined;
  effectiveReduceRounds: number | undefined;
}

export function readThreadSettings(d: Record<string, unknown>): ThreadSettings {
  return {
    connection: str(d.connection),
    model: str(d.model),
    effort: str(d.effort),
    cwd: str(d.cwd),
    agentsPath: str(d.agents_path),
    autoCompactAt: num(d.auto_compact_at),
    effectiveAutoCompactAt: num(d.effective_auto_compact_at),
    segmentChars: num(d.segment_chars),
    effectiveSegmentChars: num(d.effective_segment_chars),
    reduceRounds: num(d.reduce_rounds),
    effectiveReduceRounds: num(d.effective_reduce_rounds),
  };
}

/**
 * `config.toml` keys Settings shows. An owner older than `config.get` (#266) can't read them. Where each
 * one sits, and how it's edited, is `CONFIG_FIELDS` in `config.ts`.
 */
export type ConfigKey =
  | "default_connection"
  | "default_model"
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
  | "compaction.auto_at_tokens"
  | "compaction.segment_chars"
  | "compaction.reduce_rounds";
