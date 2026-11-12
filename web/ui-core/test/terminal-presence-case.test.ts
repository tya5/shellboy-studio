import { expect, it } from "vitest";
import { normalizeTerminalPresenceFacts, projectHistoryWindowItems } from "../src/conversation-items";
import type { TerminalPresence } from "../src/terminal-presence";
const receipt: TerminalPresence["receipt"] = { scope: "opaque", attemptId: "actual", nodeIds: ["actual-node"], terminalState: "completed" };
for (const phase of ["pending", "reading", "settled"] as const) it(`terminal ${phase} selects canonical CASE without a fake saved body or tool`, () => {
  const presence: TerminalPresence = { scope: "opaque", attemptId: "actual", receipt, phase, reason: phase === "settled" ? "partial-items" : "canonical-pending", answerAvailability: "unknown" };
  const facts = normalizeTerminalPresenceFacts([presence]);
  const out = projectHistoryWindowItems({ revision: 1,  nodes: [], liveFacts: facts }).projection;
  expect(out.items[0]?.classification).toMatchObject({ headingCategory: phase === "settled" ? "Problems" : "Notifications", icon: phase === "settled" ? "file" : "inbox", toolPolicy: "none", openPolicy: "closed" });
  expect(out.items[0]?.source).not.toHaveProperty("nodeId");
  expect(out.items[0]?.source).not.toHaveProperty("text");
  expect("domain" in out.items[0]!.source && out.items[0]!.source.terminalPresence?.receipt).toBe(receipt);
  expect(out.workGroups?.[0]?.toolItemKeys).toEqual([]);
  expect(out.workGroups?.[0]?.categoryCounts?.Tools).toBe(0);
});
it("accounted omitted facts add no status; stable receipt key survives reading/settled transition", () => {
  expect(normalizeTerminalPresenceFacts([])).toEqual([]);
  const make = (phase: TerminalPresence["phase"]) => projectHistoryWindowItems({ revision: 1,  nodes: [], liveFacts: normalizeTerminalPresenceFacts([{ scope: "opaque", attemptId: "actual", receipt, phase, reason: "missing-candidate", answerAvailability: "unknown" }]) }).projection.items[0]!.key;
  expect(make("pending")).toBe(make("settled"));
  expect(() => normalizeTerminalPresenceFacts([{ scope: "wrong", attemptId: "actual", receipt, phase: "settled", reason: "read-error", answerAvailability: "unknown" }])).toThrow();
});
it('empty complete typed text retains honest terminal presence instead of accounting an invisible body', async () => {
 const { terminalPresence } = await import('../src/terminal-presence');
 const row = (text: string, complete = true) => [{ node_id: 'actual-node', kind: 'assistant_response', items: [{ kind: 'text' as const, item_identity: 'body', text, text_complete: complete }] }];
 expect(terminalPresence(receipt, row(''), 'missing-candidate')).toMatchObject({ reason: 'body-unavailable', answerAvailability: 'unknown' });
 expect(terminalPresence(receipt, row(''), 'canonical-pending')).toMatchObject({ reason: 'body-unavailable' });
 expect(terminalPresence(receipt, row('nonempty'))).toBeUndefined();
 expect(terminalPresence(receipt, row(' '))).toBeUndefined();
 expect(terminalPresence(receipt, row('', false))).toMatchObject({ reason: 'partial-items' });
 expect(terminalPresence(receipt, [{ node_id: 'actual-node', kind: 'assistant_response', items: [{ kind: 'tool_call', item_identity: 'tool', execution_ids: [] }] }])).toBeUndefined();
});
