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
it("exact execution selection preserves each command description and state without aggregate duplication", async () => {
 const { workExecutionDisplay } = await import("../src/work-element-display");
 const [row] = display([{ node_id: "n", kind: "assistant_response", items: [{ kind: "tool_call", item_identity: "c", execution_ids: ["a", "b"] }], executions: [
 { execution_id: "a", command_excerpt: "first", description: "safe first", state: "exited", exit_code: 0 },
 { execution_id: "b", command_excerpt: "second", description: "safe second", state: "running" }] }]);
 expect(workExecutionDisplay(row!.item, "a")).toMatchObject({ contentLabel: { text: "safe first" }, state: { value: "exited", exitCode: 0 } });
 expect(workExecutionDisplay(row!.item, "b")).toMatchObject({ contentLabel: { text: "safe second" }, state: { value: "running" } });
 expect(workExecutionDisplay(row!.item, "foreign")).toBeUndefined();
});
it("module scoping accepts only issued live/receipt and never arbitrary copies or unscoped saved facts", async () => {
 const { scopeIssuedWorkFacts, normalizeLiveWorkFacts } = await import("../src/conversation-items");
 const live = normalizeLiveWorkFacts({ scope: "t", items: [{ kind: "notification", id: "n", thread_id: "t", state: "pending" }] });
 const scope = ["owner", "t"], scoped = scopeIssuedWorkFacts(live, scope)!;
 expect(Object.isFrozen(scoped)).toBe(true); expect(Object.isFrozen(scoped[0]!.keyScope)).toBe(true); scope[0] = "changed";
 expect(scoped[0]!.keyScope).toEqual(["owner", "t"]);
 expect(scopeIssuedWorkFacts(scoped, ["owner", "t"])![0]).toBe(scoped[0]);
 expect(scopeIssuedWorkFacts(scoped, ["foreign"])).toBeUndefined();
 expect(scopeIssuedWorkFacts(live, [])).toBeUndefined(); expect(scopeIssuedWorkFacts(live, [""])).toBeUndefined();
 expect(scopeIssuedWorkFacts([{ ...live[0]! }], ["s"])).toBeUndefined();
 const saved = projectLegacyHistoryItems({ nodes: [{ node_id: "x", kind: "event" }] }).projection.items[0]!.source;
 expect(scopeIssuedWorkFacts([saved], ["s"])).toBeUndefined();
 expect(scopeIssuedWorkFacts([...live, { ...live[0]! }], ["s"])).toBeUndefined();
 expect(workElementDisplay(projectSavedItems(scoped).items[0]!)).toBeDefined();
});
it("scoped receipt keeps the exact original presence and rejects altered association", async () => {
 const { scopeIssuedWorkFacts } = await import("../src/conversation-items");
 const p = { scope: "opaque", attemptId: "a", receipt: { scope: "opaque", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const }, phase: "pending" as const, reason: "canonical-pending" as const, answerAvailability: "unknown" as const };
 const issued = normalizeTerminalPresenceFacts([p]); const scoped = scopeIssuedWorkFacts(issued, ["ui", "scope"])!;
 const item = projectSavedItems(scoped).items[0]!;
 expect(workElementDisplay(item)).toMatchObject({ state: { source: "client", value: "canonical-pending" } });
 expect("domain" in item.source && item.source.domain === "receipt" && item.source.terminalPresence).toBe(p);
 const source = issued[0]!;
 if (!("domain" in source) || source.domain !== "receipt") throw new Error("Expected issued receipt");
 expect(scopeIssuedWorkFacts([{ ...source, attemptId: "other" }], ["ui"])).toBeUndefined();
});
it("spill unavailable issuer emits display facts without hydrating original content", () => {
 const [row] = display([{ node_id: "s", kind: "spill", spill_tools: { status: "unknown", items: [], truncated: false } }]);
 expect(row!.value).toMatchObject({ contentLabel: { text: "Display content is unavailable" }, detailPolicy: "unavailable" });
});
it("spill exact public execution retains details, while unrelated executions stay unassociated", async () => {
 const { workExecutionDisplay } = await import("../src/work-element-display");
 const [row] = display([{ node_id: "spill", kind: "spill", spill_tools: { status: "known", truncated: false, items: [{ call_id: "call", execution_id: "yes" }] }, executions: [
 { execution_id: "yes", command_excerpt: "printf retained", description: "retained description", state: "exited", exit_code: 0 },
 { execution_id: "no", command_excerpt: "unrelated", state: "running" }] }]);
 expect(workExecutionDisplay(row!.item, "yes")).toMatchObject({ contentLabel: { text: "retained description" }, state: { value: "exited", exitCode: 0 }, detailPolicy: "existing-shell-output" });
 expect(workExecutionDisplay(row!.item, "no")).toBeUndefined();
});
for (const spill of [false, true]) for (const variant of ['description', 'command', 'none'] as const)
it(`tool label selects one original description or command spill=${spill} variant=${variant}`, async () => {
 const { workExecutionDisplay } = await import('../src/work-element-display');
 const description = variant === 'description' ? '  Original explanation  ' : ' \t ';
 const command = variant === 'none' ? ' \n ' : '  printf original  ';
 const node: HistoryItem = { node_id: 'n', kind: spill ? 'spill' : 'assistant_response',
 ...(spill ? { spill_tools: { status: 'known' as const, truncated: false, items: [{ call_id: 'c', execution_id: 'e' }] } } : { items: [{ kind: 'tool_call' as const, item_identity: 'c', execution_ids: ['e'] }] }),
 executions: [{ execution_id: 'e', description, command_excerpt: command, state: 'exited', exit_code: 0 }] };
 const [row] = display([node]); const expected = variant === 'description' ? description : variant === 'command' ? command : 'Execution content was not provided';
 for (const bundle of [row!.value!, workExecutionDisplay(row!.item, 'e')!]) {
  expect(bundle.contentLabel.text).toBe(expected);
  expect(bundle.contentLabel.context.some(c => c.name === 'description' || c.name === 'command_excerpt')).toBe(false);
  expect(bundle.state).toEqual({ source: 'wire', value: 'exited', exitCode: 0 });
 }
});
