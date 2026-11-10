import { ConversationWindow } from "../src/window";
import type { OwnedTerminalReadLease } from "../../data/src/terminal-read";
import { expect, it } from "vitest";
import { ShellboyData } from "../../data/src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "../../data/test/harness";
const baseNodes = [
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
];
async function rig(windowCap = true) {
  const t = new FakeTransport(), db = new FakeOwnerDb(), frames: (() => void)[] = []; let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `atomic-${++n}`, schedule: cb => frames.push(cb) });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: windowCap ? ["history.window"] : [] } } }); await settle(t, db);
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
async function target() {
 const r = await rig(); const token = r.h.captureReadQualification()!;
 const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "a", revision: 7, total: 1,
 items: [{ node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] }] } }) }); await flush();
 r.live(); r.end(); await r.pump(); const record = r.h.handoff.peek()[0]!;
 expect(r.h.transferHandoff("attempt", (captured, end) => w.acceptHandoff(captured, r.h.handoffScope(), end))).toBe(true);
 return { ...r, w, token, receipt: record.terminalPersisted! };
}
it("actual status/Store/O/Window publishes honest same-ref missing-answer presence, one held canonical read then available rows", async () => {
 const r = await target(); const initial = r.w.acceptedView.peek();
 expect(r.h.handoff.peek()).toHaveLength(0); expect(initial.rows.map(row => row.node_id)).toEqual(["tool"]);
 expect(initial.terminalPresence?.[0]).toMatchObject({ phase: "pending", answerAvailability: "unknown" });
 const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease;
 expect("state" in lease).toBe(true); await flush();
 expect(r.w.prepareTerminalRead(r.h, r.token, r.receipt)).toBe(lease);
 expect(r.t.calls("history.window")).toHaveLength(1);
 expect(r.w.acceptedView.peek().terminalPresence?.[0]?.phase).toBe("reading");
 await r.pump();
 expect(r.w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["tool", "answer"]);
 expect(r.w.acceptedView.peek().terminalPresence ?? []).toEqual([]);
 expect(r.t.calls("history.window")).toHaveLength(1); expect(r.t.calls("history.get")).toHaveLength(0);
 r.w.dispose(); r.data.stop();
});
it.each(["partial", "deferred", "unknown", "missing", "error"] as const)("canonical %s preserves rows and an honest settled reason", async mode => {
 const r = await target(); r.state[mode] = true; r.w.prepareTerminalRead(r.h, r.token, r.receipt); await r.pump();
 const ref = r.w.acceptedView.peek(); expect(ref.rows.some(row => row.node_id === "tool")).toBe(true);
 expect(ref.terminalPresence?.[0]?.phase).toBe("settled"); expect(ref.terminalPresence?.[0]?.answerAvailability).toBe("unknown");
 expect(r.t.calls("history.window")).toHaveLength(1); r.w.dispose(); r.data.stop();
});
it("revoked target receives no result or stale reason publication", async () => {
 const r = await target(); r.w.prepareTerminalRead(r.h, r.token, r.receipt); await flush();
 const old = r.w.acceptedView.peek(); let notifications = 0; const stop = r.w.acceptedView.subscribe(() => notifications++);
 r.w.acceptedView.revoke(); await r.pump();
 expect(r.w.acceptedView.peek()).toBe(old); expect(notifications).toBe(0); stop(); r.w.dispose(); r.data.stop();
});
it("cancel then prepare cannot trigger a second automatic canonical request", async () => {
 const r = await target(); const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease;
 r.w.cancelTerminalRead(lease.ticket.id); await r.pump(); const count = r.t.calls("history.window").length;
 r.w.prepareTerminalRead(r.h, r.token, r.receipt); await r.pump(); expect(r.t.calls("history.window")).toHaveLength(count);
 r.w.dispose(); r.data.stop();
});
it("no-window public capability has presence-only unsupported and zero canonical RPC", async () => {
 const r = await rig(false); const { LegacyAcceptedPresentation } = await import("../src/legacy-presentation");
 r.live(); r.end(); await r.pump(); const p = new LegacyAcceptedPresentation(r.h);
 expect(p.sync()).toBe(true); expect(p.acceptedView.peek().terminalPresence?.[0]).toMatchObject({ phase: "settled", reason: "unsupported", answerAvailability: "unknown" });
 expect(r.t.calls("history.window")).toHaveLength(0); expect(r.h.handoff.peek()).toHaveLength(0); p.dispose(); r.data.stop();
});
it("wrong original qualification cannot admit or write terminal presence", async () => {
 const r = await target(); const before = r.w.acceptedView.peek(); r.h.cancelReads();
 const count = r.t.calls("history.window").length;
 expect(r.w.prepareTerminalRead(r.h, r.token, r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(r.w.acceptedView.peek()).toBe(before); expect(r.t.calls("history.window")).toHaveLength(count); r.w.dispose(); r.data.stop();
});
it("data stop invalidates held canonical lease before callback and publishes no old target result", async () => {
 const r = await target(); const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease; await flush();
 const before = r.w.acceptedView.peek(); r.data.stop(); await flush();
 expect(r.w.acceptedView.peek()).toBe(before); expect(lease.state.peek().phase).toBe("unavailable"); r.w.dispose();
});
