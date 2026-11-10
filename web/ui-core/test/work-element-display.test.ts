import { expect, it } from "vitest";
import { normalizeTerminalPresenceFacts, projectSavedItems, projectLegacyHistoryItems, CANONICAL_CASES } from "../src/conversation-items";
import { workElementDisplay } from "../src/work-element-display";
import type { HistoryItem } from "../../data/src/protocol";
function display(nodes: HistoryItem[]) {
 const result = projectLegacyHistoryItems({ nodes, keyScope: ["owner", "thread", "life"] });
 return result.projection.items.filter(item => item.classification?.classification === "work").map(item => ({ item, value: workElementDisplay(item) }));
}
it("tool metadata comes only from original exact execution association, never another shell", () => {
 const [row] = display([{ node_id: "n", kind: "assistant_response", items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["yes"] }], executions: [
 { execution_id: "no", command_excerpt: "wrong", state: "running" }, { execution_id: "yes", command_excerpt: "printf safe", state: "exited", exit_code: 0 }] }]);
 expect(row!.value).toMatchObject({ contentLabel: { text: "printf safe" }, state: { source: "wire", value: "exited", exitCode: 0 }, detailPolicy: "existing-shell-output" });
 expect(JSON.stringify(row!.value)).not.toContain("wrong");
 expect(workElementDisplay({ ...row!.item, source: { ...row!.item.source } })).toBeUndefined();
});
it.each(["reasoning", "reasoning_unavailable"])("%s publishes no inferred reasoning body", kind => {
 const [row] = display([{ node_id: "r", kind }]);
 expect(row!.value).toMatchObject({ contentLabel: { text: "Reasoning content is not publicly available" }, detailPolicy: "unavailable" });
});
it.each(["event", "context", "model_stream_observation", "message", "notification"])("%s reports honest missing context, not a fabricated cause", kind => {
 const [row] = display([{ node_id: "e", kind, provenance: { created_at: "2026-01-01T00:00:00Z" } }]);
 expect(row!.value!.contentLabel.text).toContain("2026-01-01T00:00:00Z");
 expect(row!.value!.contentLabel.text).not.toContain(kind + ":"); expect(row!.value!.state).toBeNull();
});
it.each(["interruption_details", "interruption_context", "incomplete_response", "interrupted_wait"])("%s does not infer missing response detail", kind => {
 const [row] = display([{ node_id: "i", kind }]); expect(row!.value!.contentLabel.text).toBe("Response-state details were not provided");
 expect(row!.value!.detailPolicy).toBe("unavailable");
});
it.each(["response_budget", "source_budget", "unsupported"] as const)("wire %s machine reason remains distinct and exact", reason => {
 const [row] = display([{ node_id: "u", kind: "assistant_response", items: [{ kind: "unavailable", item_identity: "u", reason }] }]);
 expect(row!.value!.state).toEqual({ source: "wire", value: reason });
 expect(row!.value!.contentLabel.context).toContainEqual({ name: "reason", value: reason });
});
it("unknown kind is metadata, not a visible type prefix", () => {
 const [row] = display([{ node_id: "u", kind: "future_kind" }]);
 expect(row!.value!.contentLabel.text).toBe("Item details are not supported");
 expect(row!.value!.contentLabel.context).toContainEqual({ name: "kind", value: "future_kind" });
});
it("tool without associated shell does not fabricate executable detail", () => {
 const [row] = display([{ node_id: "t", kind: "tool_result" }]);
 expect(row!.value!.contentLabel.text).toBe("Execution content was not provided"); expect(row!.value!.detailPolicy).toBe("unavailable");
});
it("normalizer receipt identity survives projection; machine client reason is not wire or retry eligibility", () => {
 const receipt = { scope: "s", attemptId: "a", receipt: { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const }, phase: "settled" as const, reason: "read-error" as const, answerAvailability: "unknown" as const };
 const facts = normalizeTerminalPresenceFacts([receipt]);
 const item = projectSavedItems(facts).items[0]!;
 expect(workElementDisplay(item)).toMatchObject({ state: { source: "client", value: "read-error" }, detailPolicy: "none" });
 expect(JSON.stringify(workElementDisplay(item))).not.toMatch(/retry/i);
});
it("unissued arbitrary normalized object cannot acquire facts by matching its ID", () => {
 const source = { identityDomain: "node" as const, windowRevision: 1, itemIdentity: "x", kind: "reasoning_unavailable" as const, nodeId: "r", classificationCase: "reasoningMarker" as const };
 const item = projectSavedItems([source]).items[0]!;
 expect(workElementDisplay(item)).toBeUndefined();
});
it("normalizer source-scope mutation rejects facts rather than joining by node ID", () => {
 const item = projectLegacyHistoryItems({ nodes: [{ node_id: "n", kind: "event" }], keyScope: ["s"] }).projection.items[0]!;
 expect(workElementDisplay({ ...item, source: { ...item.source, keyScope: ["foreign"] } })).toBeUndefined();
});
it("live typed public records retain their exact state and no guessed body", async () => {
 const { normalizeLiveWorkFacts } = await import("../src/conversation-items");
 const facts = normalizeLiveWorkFacts({ scope: "t", items: [{ kind: "notification", id: "n", thread_id: "t", state: "pending" }] });
 const item = projectSavedItems(facts).items[0]!;
 expect(workElementDisplay(item)).toMatchObject({ contentLabel: { text: "Item details are not supported" }, state: { source: "wire", value: "pending" } });
});
it("all issued Work CASE paths yield nonempty content and one literal icon without copying bodies", () => {
 const nodes: HistoryItem[] = [{ node_id: "n", kind: "assistant_response", items: [
 { kind: "tool_result", item_identity: "result", execution_ids: [] }, { kind: "reasoning_unavailable", item_identity: "r" },
 { kind: "unavailable", item_identity: "u", reason: "legacy" }] }];
 for (const row of display(nodes)) { expect(row.value!.contentLabel.text.trim()).not.toBe(""); expect(row.value!.typeIcon).toBe(row.item.classification?.icon); }
});
it("changed receipt association cannot inherit the original display facts", () => {
 const presence = { scope: "s", attemptId: "a", receipt: { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const }, phase: "pending" as const, reason: "canonical-pending" as const, answerAvailability: "unknown" as const };
 const item = projectSavedItems(normalizeTerminalPresenceFacts([presence])).items[0]!;
 expect(workElementDisplay({ ...item, source: { ...item.source, keyScope: ["foreign"] } })).toBeUndefined();
});
