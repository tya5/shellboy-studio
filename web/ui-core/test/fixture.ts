// The shared fixture: one fake owner behind the data layer's fake transport, with records in the
// shapes observed on a real owner. Every design's smoke test renders this. Examples, not data.
import { signal } from "@preact/signals-core";
import { connected, details, FakeOwnerDb, FakeTransport, settle, summary } from "../../data/test/harness";
import { ShellboyData } from "../../data/src";
import { AppModel, noPending, type PendingAdapter, type PendingItem } from "../src";

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

export async function fixtureModel(options: { pending?: PendingAdapter; route?: "conversation" | "monitor" | "inbox" } = {}) {
  const t = new FakeTransport();
  const db = fixtureDb();
  const data = new ShellboyData({ transport: t, newId: () => "op-1" });
  const model = new AppModel({ data, pending: options.pending ?? noPending, nowMs: () => NOW });
  if (options.route) model.applyRoute({ view: options.route });
  model.start();
  t.open();
  t.push({ t: "hello", bridge_version: "0.0.1", owner: connected });
  await settle(t, db);
  return { t, db, model, data };
}

export { settle };
