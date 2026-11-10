import { expect, it } from "vitest";
import { ConversationWindow } from "../src/window";
import { ShellboyData } from "../../data/src/store";
import type { HistoryItem } from "../../data/src";
import { connected, FakeTransport, flush } from "../../data/test/harness";
async function rig() {
  const t = new FakeTransport(); let id = 0; const data = new ShellboyData({ transport: t, newId: () => `coverage-${++id}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); await flush();
  const h = data.openThread("t");
  const source: HistoryItem[] = [{ node_id: "a", kind: "user", selection: { ordinal: 0 }, items: [] }, { node_id: "b", kind: "user", selection: { ordinal: 1 }, items: [] }];
  let target = false;
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "t", revision: target ? 2 : 1, total: 2,
    items: target ? [{ node_id: "summary", kind: "summary", selection: { ordinal: 0 }, items: [] }, source[1]!] : source } }) });
  await flush(); const ref = w.acceptedView.peek();
  return { t, data, h, w, ref, change: async () => { target = true; w.changed(); await flush(); } };
}
it.each(["inside", "below"] as const)("publishes direct %s membership on a separately current target, consumes once without callbacks/ref changes", async kind => {
  const r = await rig(); const id = r.w.beginSummaryTransition(r.h, r.ref, kind === "inside" ? "a" : "b", 20)!; expect(id).toBeDefined();
  expect(r.w.beginSummaryTransition(r.h, r.ref, kind === "inside" ? "a" : "b", 20)).toBe(id);
  expect(r.w.beginSummaryTransition(r.h, r.ref, "a", 90)).toBeUndefined();
  await r.change(); const target = r.w.acceptedView.peek(); expect(target.revision).toBe(2);
  expect(r.w.acceptSummaryCoverage(r.h, target, id, { node_id: "summary", kind: "summary", text: "", source_node_ids: ["a"] })).toBe(true);
  const accepted = r.w.acceptedView.peek(), cap = r.w.acceptedView.currentCapability;
  expect(accepted.coverage).toMatchObject({ transitionId: id, kind, source: { offset: 20, revision: 1 }, targetRevision: 2 });
  let callbacks = 0; r.w.acceptedView.subscribe(() => callbacks++);
  expect(r.w.consumeSummaryCoverage(target, id)).toBe(false); expect(r.w.peekSummaryCoverage(accepted)).toBeDefined();
  expect(r.w.consumeSummaryCoverage(accepted, "wrong" as typeof id)).toBe(false);
  expect(r.w.consumeSummaryCoverage(accepted, id)).toBe(true); expect(r.w.consumeSummaryCoverage(accepted, id)).toBe(false);
  expect(r.w.acceptedView.peek()).toBe(accepted); expect(r.w.acceptedView.currentCapability).toBe(cap); expect(callbacks).toBe(0);
  r.w.dispose(); r.h.close(); r.data.stop();
});
it.each(["missing", "empty", "duplicate", "unknown", "above", "pause", "close", "revoke", "dispose"])("rejects %s without consuming authority", async mode => {
  const r = await rig(); const id = r.w.beginSummaryTransition(r.h, r.ref, "a", 20)!;
  await r.change(); const ref = r.w.acceptedView.peek();
  if (mode === "pause") r.h.pause(); if (mode === "close") r.h.close(); if (mode === "revoke") r.w.acceptedView.revoke(); if (mode === "dispose") r.w.dispose();
  const ids = mode === "empty" ? [] : mode === "duplicate" ? ["a", "a"] : mode === "unknown" ? ["unknown"] : mode === "above" ? ["b"] : mode === "missing" ? undefined : ["a"];
  expect(r.w.acceptSummaryCoverage(r.h, ref, id, { node_id: "summary", kind: "summary", text: "", source_node_ids: ids })).toBe(false);
  expect(r.w.peekSummaryCoverage(ref)).toBeUndefined(); r.w.dispose(); r.data.stop();
});
it("pending display facts publish with the same saved ref and failure unmasks without removing saved nodes", async () => {
  const r = await rig(); const trace: unknown[] = []; r.w.acceptedView.subscribe(ref => trace.push({ rows: ref.rows.map(row => row.node_id), states: ref.attemptPresentations?.map(f => f.state) }));
  const fact = { scope: r.h.handoffScope(), attemptId: "attempt", turnId: "turn", nodeIds: ["a"], state: "pending" as const };
  r.w.setAttemptPresentations([fact]); expect(r.w.acceptedView.peek().attemptPresentations![0]!.nodeIds).toEqual(["a"]);
  r.w.setAttemptPresentations([{ ...fact, state: "failed" }]);
  expect(trace).toEqual([{ rows: ["a", "b"], states: ["pending"] }, { rows: ["a", "b"], states: ["failed"] }]); r.w.dispose(); r.data.stop();
});
