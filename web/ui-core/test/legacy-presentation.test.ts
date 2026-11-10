import { LegacyAcceptedPresentation } from "../src/legacy-presentation";
import { expect, it } from "vitest";
import { ShellboyData } from "../../data/src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "../../data/test/harness";
const baseNodes = [
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
];
async function rig() {
  const t = new FakeTransport(), db = new FakeOwnerDb(), frames: (() => void)[] = []; let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `atomic-${++n}`, schedule: cb => frames.push(cb) });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); await settle(t, db);
  const h = data.openThread("a"); await settle(t, db);
  const state = { available: true, truncated: false, partial: false, deferred: false, unknown: false, missing: false, error: false, changing: false, nonterminal: false, wrongid: false, empty: false, hold: false };
  const original = db.answer.bind(db); let reads = 0;
  db.answer = call => {
    if (call.command === "status") return { ok: true, result: { items: state.available ? [{ kind: "attempt", id: state.wrongid ? "other" : "attempt", attempt_id: "attempt", turn_id: "turn", thread_id: "a", state: state.nonterminal ? "inflight" : "completed", response_nodes: state.empty ? [] : [{ node_id: "answer", ordinal: 0, kind: "message" }, { node_id: "tool", ordinal: 1, kind: "function_call" }, { node_id: "answer", ordinal: 2, kind: "message" }], response_nodes_truncated: state.truncated }] : [] } };
    if (call.command === "history.window") {
      if (state.error) return { ok: false, code: "not_found", message: "synthetic" };
      const items: unknown[] = structuredClone(baseNodes);
      if (state.partial) (items[1] as { items: unknown }).items = [{ kind: "text", item_identity: "text", text: "prefix", text_complete: false }];
      if (state.deferred) { (items[1] as { items: unknown }).items = null; (items[1] as object & { items_unavailable_reason: string }).items_unavailable_reason = "response_budget"; }
      if (state.unknown) (items[1] as { items: unknown }).items = [{ kind: "unavailable", item_identity: "missing", reason: "opaque" }];
      if (state.missing) items.pop();
      if (state.changing) { if (++reads === 1) items.splice(1); else items.splice(0, 1); }
      return { ok: true, result: { thread_id: "a", revision: state.changing && reads > 1 ? 8 : 7, total: 2, items } };
    }
    return original(call);
  };
  const live = () => { t.push({ t: "live", thread_id: "a", attempt_id: "attempt", gap: false, deltas: [{ offset: 0, reasoning: false, text: "whole live block" }] }); frames.splice(0).forEach(f => f()); };
  const end = () => t.push({ t: "live_end", thread_id: "a" });
  return { t, db, data, h, state, live, end, pump: () => settle(t, db) };
}
it("no-window view accepts available saved rows and terminal retirement in one notification, no fake revision/read", async () => {
  const r = await rig(); r.live(); r.end(); await r.pump();
  const p = new LegacyAcceptedPresentation(r.h), trace: unknown[] = [];
  p.acceptedView.subscribe(ref => trace.push({ live: ref.live.length, terminal: ref.terminalPersistedAttempts.length, rows: ref.rows.map(row => row.node_id) }));
  const beforeReads = r.t.calls().length;
  expect(p.sync()).toBe(true); expect(trace).toHaveLength(1);
  const ref = p.acceptedView.peek(); expect(ref.terminalPersistedAttempts[0]?.attemptId).toBe("attempt");
  expect("revision" in ref).toBe(false); expect(p.isCurrent(ref)).toBe(true); expect(r.t.calls()).toHaveLength(beforeReads);
  expect(r.h.handoff.peek()).toHaveLength(0); p.dispose(); r.data.stop();
});
for (const action of ["pause", "close", "ownerABA", "dispose"] as const) it(`legacy accepted authority rejects ${action} without recapture`, async () => {
  const r = await rig(); const p = new LegacyAcceptedPresentation(r.h); expect(p.sync()).toBe(true); const old = p.acceptedView.peek();
  if (action === "pause") { r.h.pause(); r.h.resume(); } else if (action === "close") r.h.close(); else if (action === "dispose") p.dispose(); else r.t.push({ t: "owner", event: "restarted", owner: connected });
  expect(p.isCurrent(old)).toBe(false); expect(p.sync()).toBe(false); p.dispose(); r.data.stop();
});
it("reentry invalidation during accepted publication suppresses old O release", async () => {
  const r = await rig(); r.live(); r.end(); await r.pump(); const p = new LegacyAcceptedPresentation(r.h);
  p.acceptedView.subscribe(() => p.dispose()); expect(p.sync()).toBe(false);
  expect(r.h.handoff.peek()).toHaveLength(1); r.data.stop();
});
