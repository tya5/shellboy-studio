// The shared fixture: one fake owner behind the data layer's fake transport, with records in the
// shapes observed on a real owner. Every design's smoke test renders this. Examples, not data.
import { signal } from "@preact/signals-core";
import { connected, details, FakeOwnerDb, FakeTransport, settle, summary } from "../../data/test/harness";
import { ShellboyData } from "../../data/src";
import { AppModel, noPending, type PendingAdapter, type PendingItem, type Route, type ViewName } from "../src";

export const NOW = Date.parse("2026-11-07T10:20:00+00:00");
const at = (minute: number, second = 0) => `2026-11-07T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000000+00:00`;

let ordinal = 0;
const node = (kind: string, created: string, excerpt: string, extra: Record<string, unknown> = {}) => ({
  node_id: `node-${ordinal}`,
  kind,
  excerpt,
  execution_count: 0,
  executions_truncated: false,
  provenance: { created_at: created, kind, sender: { kind: "human" } },
  selection: { ordinal: ordinal++ },
  ...extra,
});

export function fixtureDb(): FakeOwnerDb {
  ordinal = 0;
  const db = new FakeOwnerDb();
  db.threads = {
    lead: summary("lead", { title: "Improve history search", cwd: "/home/me/dev/shellboy", state: "running", activity: "tools", updated_at: at(19), excerpt: "Coordinating review and verification" }),
    child: summary("child", { title: "Review query path", cwd: "/home/me/dev/shellboy", parent_id: "lead", state: "running", activity: "awaiting_model", updated_at: at(18), excerpt: "Inspecting ranking logic" }),
    done: summary("done", { title: "Inspect storage", cwd: "/home/me/dev/shellboy", parent_id: "lead", state: "completed", activity: "completed", updated_at: at(10), excerpt: "Indexes verified" }),
    broken: summary("broken", { title: "Check embedding endpoint", cwd: "/home/me/dev/rag", state: "recovery_wait", activity: "recovery", updated_at: at(19), excerpt: "Connection interrupted" }),
    hold: summary("hold", { title: "Wait for the nightly build", cwd: "/home/me/dev/rag", state: "waiting", activity: "waiting", updated_at: at(5), excerpt: "Waiting for a child" }),
  } as FakeOwnerDb["threads"];
  db.details.lead = details("lead", {
    title: "Improve history search",
    cwd: "/home/me/dev/shellboy",
    model: "example-model",
    run_id: "run-1",
    children_count: 2,
    effective_auto_compact_at: 200000,
    context_usage: { last_successful_attempt: { input_tokens: 41200, cached_tokens: 38000 } },
    usage_totals: {
      model_attempts: {
        completed: {
          count: 4,
          input_tokens: { known_sum: 160000, overflow: false, unknown_count: 0 },
          output_tokens: { known_sum: 3200, overflow: false, unknown_count: 0 },
          cached_tokens: { known_sum: 120000, overflow: false, unknown_count: 0 },
        },
      },
    },
  }) as FakeOwnerDb["details"][string];
  db.details.broken = details("broken", {
    title: "Check embedding endpoint",
    cwd: "/home/me/dev/rag",
    model: "example-model",
    run_id: "run-2",
    recovery_reason: JSON.stringify({ code: "io_failed", message: "provider: connection interrupted", hint: "Choose an action" }),
  }) as FakeOwnerDb["details"][string];
  const execution = { execution_id: "exec-1", command_excerpt: "cargo test history::search", command_truncated: false, cwd: "/home/me/dev/shellboy", state: "exited", call_state: "completed" };
  db.history.lead = [
    node("user", at(14), "Improve history search and verify the changes."),
    node("event", at(14, 1), 'Shellboy event v1: {"kind":"run_started"}'),
    node("context", at(14, 2), "Shellboy context v1: thread=lead"),
    node("assistant_response", at(14, 3), "I'll inspect the query path and run **focused tests**."),
    node("assistant_response", at(14, 4), '{"command":"cargo test history::search"}', { execution_count: 1, executions: [execution] }),
    node("tool_result", at(14, 7), '{"exit_code":0}', { execution_count: 1, executions: [execution] }),
    node("assistant_response", at(15), "Storage review is complete. Checking ranking behaviour next."),
  ];
  db.history.broken = [node("user", at(19), "Check the embedding endpoint.")];
  db.shells.lead = [{ execution_id: "exec-1", state: "exited", exit_code: 0, started_at: at(14, 4), ended_at: `2026-11-07T10:14:06.400000+00:00`, command_excerpt: "cargo test history::search" }];
  db.outputs["exec-1"] = "running 12 tests\ntest result: ok. 12 passed\n";
  return db;
}

export const fixturePending: PendingItem[] = [
  { id: "q1", threadId: "broken", threadTitle: "Invoice recipient", question: "Should this go to company A or B?", askedAt: at(8) },
  { id: "q2", threadId: "hold", threadTitle: "Mail drafts", question: "I drafted 3 replies. Please review them.", askedAt: at(1) },
];

export const fixturePendingAdapter = (items: PendingItem[] = fixturePending): PendingAdapter & { answers: [string, string][] } => {
  const answers: [string, string][] = [];
  return {
    items: signal(items),
    answers,
    answer: async (id, text) => {
      answers.push([id, text]);
      return { ok: true, value: {} };
    },
  };
};

// ---- Analytics, Resources and Settings, in the shapes `shellboy` v0.10.0 returned ----

const sum = (known: number | null, unknown = 0, overflow = false) => ({ known_sum: known, unknown_count: unknown, overflow });

/** One `usage.get` group with the fields the owner returned on a real grouped read. */
export function usageItem(key: string, f: { input: number | null; cached: number | null; output: number | null; count?: number; unknown?: number; compactions?: number; summary?: [number, number, number]; state?: string }) {
  const summary = f.summary ?? [0, 0, 0];
  const count = f.count ?? 10;
  return {
    key,
    cache: { paired_count: count, ratio: f.input ? (f.cached ?? 0) / f.input : null, unknown_pair_count: f.unknown ?? 0 },
    compaction: {
      compactions: f.compactions ?? 0,
      requests: f.compactions ?? 0,
      map_requests: f.compactions ?? 0,
      reduce_requests: 0,
      oversized_reduce_parts: 0,
      input_tokens: sum(summary[0]),
      cached_tokens: sum(summary[1]),
      cache_creation_tokens: sum(null, 1),
      output_tokens: sum(summary[2]),
    },
    connection_rates: { by_connection: { local: { applied_wait_ms: 0, http_429: 0, http_5xx: 0, overflow: false, status_unknown: 0, wait_unknown: 0 } }, coverage: "current candidate window; unknown facts excluded from counts" },
    input_per_request: { known_count: count, max: 60000, mean: f.input ? f.input / count : null, p50: 45000, p95: 60000, percentile_method: "nearest_rank", states: ["completed", "failed", "incomplete"], unknown_count: f.unknown ?? 0 },
    model_attempts: {
      [f.state ?? "completed"]: {
        count,
        input_tokens: sum(f.input, f.unknown ?? 0),
        cached_tokens: sum(f.cached, f.unknown ?? 0),
        output_tokens: sum(f.output, f.unknown ?? 0),
        reasoning_tokens: sum(0),
        total_tokens: sum(0),
        duration_ms: sum(69),
        unknown_start_count: 0,
      },
    },
  };
}

export function usagePage(items: unknown[], next?: string) {
  return {
    compaction_byte_limit: 4194304,
    elapsed_ms: 6.5,
    excluded_time_count: 0,
    group_by: "day",
    group_limit: 168,
    items,
    malformed_compaction_records: 0,
    matched_attempts: items.length * 10,
    matched_compactions: 1,
    more: next !== undefined,
    next_cursor: next ?? null,
    outside_period_count: 0,
    row_limit: 10000,
    scan_truncated: next !== undefined,
    scanned_candidates: 10000,
    scanned_compaction_bytes: 2472,
    scanned_compaction_candidates: 6,
    scope_complete: true,
    statistics_scope: "current_candidate_window",
    thread_id: null,
    timezone: "+09:00",
    unknown_time_compaction_records: 0,
  };
}

export const fixtureCompaction = {
  coverage: { candidate_limit_reached: false, source_candidate_limit: 13 },
  more: false,
  items: [
    {
      at: "2026-11-07T02:24:23.579280+00:00",
      attempt_id: "attempt-1",
      event_id: "event-1",
      kind: "automatic_reduction",
      metrics: {
        source_characters: 5259,
        summary_characters: 28,
        summary_usage: { requests: 1, map_requests: 1, reduce_requests: 0, input_tokens: sum(3200), cached_tokens: sum(320), cache_creation_tokens: sum(null, 1), output_tokens: sum(400) },
      },
      post_compaction_attempt_id: "attempt-2",
      post_compaction_input_tokens: 3300,
      reason: "proactive_threshold",
      record_kind: "retained_replacement",
      state: "adopted",
      thread_id: "lead",
      trigger: { auto_at_tokens: 60000, input_tokens: 60000 },
    },
    { at: "2026-11-06T02:00:00+00:00", attempt_id: "attempt-3", event_id: "event-2", kind: "manual", metrics: {}, post_compaction_attempt_id: null, post_compaction_input_tokens: null, state: "adopted", thread_id: "lead" },
  ],
};

export const fixtureMemory = {
  accounting: "Existing cache budget accounting, not total heap; snapshots are not atomic or additive",
  caches: {
    attachment: { entries: 0, entry_unit: "path", limit_bytes: 67108864, live_encoded_bytes: 0, pinned_bytes: 0, retained_bytes: 0, unavailable_reason: null },
    body: { entries: null, limit_bytes: 33554432, retained_bytes: null, unavailable_reason: "UI cache owner is not available" },
    layout: { entries: null, limit_bytes: 16777216, retained_bytes: null, unavailable_reason: "UI cache owner is not available" },
    replay: { entries: 1, entry_unit: "thread", limit_bytes: 33554432, live_bytes: 57373, pinned_bytes: 0, retained_bytes: 57373, unavailable_reason: null },
  },
  process: {
    metrics: {
      footprint: { bytes: 10306752, unavailable_reason: null },
      private_bytes: { bytes: null, unavailable_reason: "Not provided on this platform" },
      rss: { bytes: 18415616, unavailable_reason: null },
    },
    observed_at: "2026-11-07T02:24:26.934228+00:00",
    pid: 28385,
    platform: "macos",
  },
};

export const fixtureStorage = {
  database_reusable_bytes: 4096,
  db_bytes: 4005957632,
  filesystem_free_bytes: 103160946688,
  limit_reached: false,
  log_bytes: 4654,
  logical_history_bytes: 2147483648,
  logical_index_bytes: 524288000,
  logical_live_bytes: 2671771648,
  logical_managed_bytes: 0,
  logical_raw_bytes: 0,
  managed_bytes: 0,
  reclaimable_bytes: 1048576,
  reclaimable_is_lower_bound: true,
  wal_bytes: 1528552,
  warning: false,
};

export const fixtureIndex = {
  auto_history: true,
  done: 40,
  failed: 1,
  held_auto_history: 0,
  pause_id: null,
  paused: false,
  paused_at: null,
  pending: 2,
  probes: [],
  running: 0,
  spaces: [{ space_id: "space-1", connection: "local", model: "mock-embed", dimension: 1024, requested_dimensions: null, segments: 812, vector_payload_bytes: 3325952, state: "active", selected: true }],
  spaces_total: 1,
  spaces_truncated: false,
};

const fixtureUsagePages: Record<string, ReturnType<typeof usagePage>> = {
  first: usagePage([usageItem("2026-11-05", { input: 1000000, cached: 750000, output: 20000 }), usageItem("2026-11-06", { input: 2000000, cached: 1000000, output: 30000, compactions: 2, summary: [3200, 320, 400] })], "second"),
  second: usagePage([usageItem("2026-11-06", { input: 1000000, cached: 500000, output: 10000 }), usageItem("2026-11-07", { input: 500000, cached: 100000, output: 5000, compactions: 1, summary: [1000, 0, 100] })]),
};

export function answerInsights(db: FakeOwnerDb, usage: Record<string, unknown> = fixtureUsagePages): void {
  const plain = db.answer.bind(db);
  db.answer = (c) => {
    const a = (c.args ?? {}) as Record<string, unknown>;
    switch (c.command) {
      case "usage.get":
        db.reads.push(`usage.get@${String(a.cursor ?? "first")}:${String(a.group_by)}`);
        if (a.group_by === "thread") return { ok: true, result: usagePage([usageItem("lead", { input: 3000000, cached: 2000000, output: 40000, compactions: 3, summary: [4200, 320, 500] }), usageItem("gone-thread", { input: 1000, cached: 0, output: 10 })]) };
        return { ok: true, result: usage[String(a.cursor ?? "first")] };
      case "compact.list":
        return { ok: true, result: fixtureCompaction };
      case "storage.status":
        return { ok: true, result: fixtureStorage };
      case "index.status":
        return { ok: true, result: fixtureIndex };
      case "status":
        return { ok: true, result: a.memory ? fixtureMemory : { items: [], receipt_budget: { accounted_bytes: 13214, at_limit: false, limit_bytes: 268435456, result_retention_seconds: 86400 } } };
      case "model.list":
        return { ok: true, result: { api: "responses", connection: "local", models: ["mock-large", "mock-small"], unavailable_features: [] } };
      default:
        return plain(c);
    }
  };
}

export async function fixtureModel(options: { pending?: PendingAdapter; route?: ViewName; section?: Route["section"]; usage?: Record<string, unknown> } = {}) {
  const t = new FakeTransport();
  const db = fixtureDb();
  answerInsights(db, options.usage);
  const data = new ShellboyData({ transport: t, newId: () => "op-1" });
  const model = new AppModel({ data, pending: options.pending ?? noPending, nowMs: () => NOW, offsetMinutes: () => 540 });
  if (options.route) model.applyRoute({ view: options.route, ...(options.section && { section: options.section }) });
  model.start();
  t.open();
  t.push({ t: "hello", bridge_version: "0.0.1", owner: connected });
  // `settle` gives up after 50 rounds; a test that walks further keeps answering itself.
  await settle(t, db).catch(() => undefined);
  return { t, db, model, data };
}

export { settle };
