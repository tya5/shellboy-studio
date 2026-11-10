import { expect, it } from "vitest";
import { normalizeTerminalPresenceFacts, projectLegacyHistoryItems } from "../src/conversation-items";
import type { TerminalPresence } from "../src/terminal-presence";
const receipt: TerminalPresence["receipt"] = { scope: "opaque", attemptId: "actual", nodeIds: ["actual-node"], terminalState: "completed" };
for (const phase of ["pending", "reading", "settled"] as const) it(`terminal ${phase} selects canonical CASE without a fake saved body or tool`, () => {
  const presence: TerminalPresence = { scope: "opaque", attemptId: "actual", receipt, phase, reason: phase === "settled" ? "partial-items" : "canonical-pending", answerAvailability: "unknown" };
  const facts = normalizeTerminalPresenceFacts([presence]);
  const out = projectLegacyHistoryItems({ nodes: [], liveFacts: facts }).projection;
  expect(out.items[0]?.classification).toMatchObject({ headingCategory: phase === "settled" ? "Problems" : "Notifications", icon: phase === "settled" ? "file" : "inbox", toolPolicy: "none", openPolicy: "closed" });
  expect(out.items[0]?.source).not.toHaveProperty("nodeId");
  expect(out.items[0]?.source).not.toHaveProperty("text");
  expect("domain" in out.items[0]!.source && out.items[0]!.source.terminalPresence?.receipt).toBe(receipt);
  expect(out.workGroups?.[0]?.toolItemKeys).toEqual([]);
  expect(out.workGroups?.[0]?.categoryCounts?.Tools).toBe(0);
});
it("accounted omitted facts add no status; stable receipt key survives reading/settled transition", () => {
  expect(normalizeTerminalPresenceFacts([])).toEqual([]);
  const make = (phase: TerminalPresence["phase"]) => projectLegacyHistoryItems({ nodes: [], liveFacts: normalizeTerminalPresenceFacts([{ scope: "opaque", attemptId: "actual", receipt, phase, reason: "missing-candidate", answerAvailability: "unknown" }]) }).projection.items[0]!.key;
  expect(make("pending")).toBe(make("settled"));
  expect(() => normalizeTerminalPresenceFacts([{ scope: "wrong", attemptId: "actual", receipt, phase: "settled", reason: "read-error", answerAvailability: "unknown" }])).toThrow();
});
