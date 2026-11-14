import { expect, it } from "vitest";
import { ConversationWindow } from "../src/window";
import type { HandoffRecord, PresentationContainerId, TerminalPersistedProof } from "../../data/src/handoff";
import { flush } from "../../data/test/harness";
import { projectHistoryWindowItems } from "../src/conversation-items";
async function rig() {
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "t", revision: 1, total: 1, items: [{ node_id: "outside", kind: "user", items: [], selection: { ordinal: 0 } }] } }) }); await flush();
  return w;
}
for (const state of ["completed", "failed", "incomplete", "cancelled"] as const) it(`terminal ${state} plus persisted refs retires overlay without full readback and keeps every available saved row`, async () => {
  const w = await rig(); const proof: TerminalPersistedProof = { scope: "scope", attemptId: "a", nodeIds: ["not-loaded"], terminalState: state,
    recordKey: "live", presentationContainer: "presentation:test" as PresentationContainerId,
    refs: [{ nodeId: "not-loaded", ordinal: 4, kind: "assistant_response" }] };
  const record: HandoffRecord = { key: "live", presentationContainer: "presentation:test" as PresentationContainerId, attemptId: "a", text: "synthetic live", status: "confirming", bodyAuthority: "preview", incomplete: true, terminalPersisted: proof };
  w.setAttemptPresentations([{ scope: "scope", attemptId: "a", turnId: "turn", nodeIds: ["outside"], state: "pending" }]);
  const trace: unknown[] = []; w.acceptedView.subscribe(ref => trace.push({ rows: ref.rows.map(row => row.node_id), pending: ref.attemptPresentations?.length, terminal: ref.terminalPersistedAttempts?.length }));
  let ends = 0; expect(w.acceptHandoff(record, "scope", () => ends++)).toBe(true);
  expect(trace).toEqual([{ rows: ["outside"], pending: 0, terminal: 1 }]); expect(ends).toBe(1);
  const published = w.acceptedView.peek(), plan = published.displayPlan!;
  const expectedProjection = projectHistoryWindowItems({ revision: 1, nodes: [{ node_id: "outside", kind: "user", items: [], selection: { ordinal: 0 } }], keyScope: [""] }).projection;
  expect(plan.coverage).toBe("unavailable");
  expect(plan.acceptedGeneration).toBe(published.generation);
  expect(plan.revision).toBe(1);
  expect(plan.capability).toBe(w.acceptedView.currentCapability);
  expect(plan.entries.map(entry => entry.item)).toEqual(expectedProjection.items);
  expect(plan.sequence).toEqual(expectedProjection.sequence ?? []);
  expect(plan.workGroups).toEqual(expectedProjection.workGroups ?? []);
  expect(plan.entries.map(entry => entry.body)).toEqual([{ kind: "unavailable", reason: "ordinaryEmpty", cut:{generation: plan.acceptedGeneration, revision: 1,capability:plan.capability,scope:plan.scope} }]);
  expect(plan.entries.map(entry => entry.presentationContainer)).toEqual([undefined]);
  expect(plan.entries.map(entry => entry.lifetime)).toEqual([{ kind: "retained", scope: "", cut:{generation: plan.acceptedGeneration, revision: 1,capability:plan.capability,scope:plan.scope} }]);
  w.dispose();
});
it.each(["empty", "wrongscope", "wrongattempt", "revoke"])("does not retire when authority is %s", async mode => {
  const w = await rig(); const proof: TerminalPersistedProof = { scope: "scope", attemptId: "a", nodeIds: mode === "empty" ? [] : ["saved"], terminalState: "completed" };
  const record: HandoffRecord = { key: "live", presentationContainer: "presentation:test" as PresentationContainerId, attemptId: mode === "wrongattempt" ? "b" : "a", text: "live", status: "confirming", bodyAuthority: "preview", incomplete: false, terminalPersisted: proof };
  if (mode === "revoke") w.acceptedView.revoke();
  let ends = 0; expect(w.acceptHandoff(record, mode === "wrongscope" ? "other" : "scope", () => ends++)).toBe(false); expect(ends).toBe(0); w.dispose();
});
