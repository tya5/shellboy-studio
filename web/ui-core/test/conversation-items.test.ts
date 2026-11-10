import { describe, expect, it } from "vitest";
import { projectHistoryWindowItems, projectSavedItems, type NormalizedSavedItem } from "../src/conversation-items";
const text = (nodeId: string, itemIdentity: string, value: string): NormalizedSavedItem => ({ nodeId, itemIdentity, revision: "r1", kind: "text", text: value });
const tool = (nodeId: string, itemIdentity: string, executionId: string): NormalizedSavedItem => ({ nodeId, itemIdentity, revision: "r1", kind: "tool", executionId });

describe("internal saved ordered-item projection (no wire adapter)", () => {
  it("splits on every body item, never on a node boundary", () => {
    const input = [text("A", "t", "before"), tool("A", "x", "x"), tool("B", "y", "y"), text("B", "t", "between"), tool("B", "z", "z")];
    const out = projectSavedItems(input);
    expect(out.items.map(i => i.source)).toEqual(input);
    expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x", "y"], ["z"]]);
    expect(out.toolSummaries[0]?.memberKeys).toEqual(out.items.slice(1, 3).map(i => i.key));
  });
  it("keeps content keys when preceding tools merge a summary", () => {
    const existing = [tool("B", "y", "y"), text("B", "t", "body")];
    const old = projectSavedItems(existing);
    const next = projectSavedItems([tool("A", "x", "x"), ...existing]);
    expect(next.items.slice(1).map(i => i.key)).toEqual(old.items.map(i => i.key));
    expect(next.toolSummaries[0]?.executionIds).toEqual(["x", "y"]);
    expect(next.toolSummaries[0]?.anchorKey).not.toBe(old.toolSummaries[0]?.anchorKey);
  });
  it("deduplicates actual execution association without erasing body boundaries", () => {
    const out = projectSavedItems([tool("A", "request", "x"), tool("B", "result", "x"), text("C", "t", "body"), tool("D", "other", "y")]);
    expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x"], ["y"]]);
    expect(out.items.filter(i => i.source.kind === "tool")).toHaveLength(2);
  });
  it("keeps the key domain independent of content revision and identical text", () => {
    const before = projectSavedItems([text("A", "first", "same"), text("A", "second", "same")]);
    const input = { ...text("A", "first", "changed"), revision: "r2" };
    const after = projectSavedItems([input, text("A", "second", "same")]);
    expect(new Set(before.items.map(i => i.key)).size).toBe(2);
    expect(after.items.map(i => i.key)).toEqual(before.items.map(i => i.key));
    expect(after.items[0]?.source.revision).toBe("r2");
  });
  it("uses text items, including empty bodies, as explicit group boundaries", () => {
    const out = projectSavedItems([tool("A", "x", "x"), text("A", "empty", ""), tool("A", "y", "y")]);
    expect(out.items[1]?.source).toEqual(text("A", "empty", ""));
    expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x"], ["y"]]);
  });


  it.todo("same-revision evidence monotonicity and new-revision authorization require adapter proof");
});

it("materializes immutable data and preserves unknown partitions without reasoning text", () => {
  const source = [tool("A", "x", "x"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning", text: "must not leak" }, tool("B", "y", "y"), { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unavailable" }, tool("C", "z", "z")] as NormalizedSavedItem[];
  const out = projectSavedItems(source);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x", "y"], ["z"]]);
  expect(out.partitionUnknownKeys).toEqual([out.items[2]!.key]);
  expect(JSON.stringify(out)).not.toContain("must not leak");
  expect(Object.isFrozen(out)).toBe(true);
  expect(Object.isFrozen(out.items[0]?.source)).toBe(true);
  source.splice(0);
  expect(out.items).toHaveLength(4);
});
it("rejects absent or duplicate authority instead of inventing a key", () => {
  expect(() => projectSavedItems([text("", "x", "value")])).toThrow();
  expect(() => projectSavedItems([text("A", "x", "one"), text("A", "x", "two")])).toThrow();
  expect(() => projectSavedItems([tool("A", "x", "")])).toThrow();
});
it("keeps identity tuples unambiguous and renders execution only once across text", () => {
  const out = projectSavedItems([tool("A", "x", "exec"), text("A", "body", "body"), tool("B", "r", "exec"), text("A/x", "y", "one"), text("A", "x/y", "two")]);
  expect(new Set(out.items.map(i => i.key)).size).toBe(out.items.length);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["exec"]]);
  expect(out.items.filter(i => i.source.kind === "text")).toHaveLength(3);
});

it("v3 keeps contentless reasoning transparent and unknown as a barrier", () => {
  const out = projectSavedItems([tool("A", "a", "a"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning" }, tool("B", "b", "b"), { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unavailable" }, tool("C", "c", "c")]);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["a", "b"], ["c"]]);
  expect(out.items.some(i => i.source.kind === "reasoning")).toBe(false);
  expect(out.partitionUnknownKeys).toEqual([out.items.find(i => i.source.kind === "unavailable")!.key]);
});

it("v3 explicit reasoning_unavailable is transparent and unknown never fabricates text", () => {
  const out = projectSavedItems([tool("A", "a", "a"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning_unavailable" }, tool("B", "b", "b"), { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unknown" }, text("C", "empty", ""), tool("C", "c", "c")]);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["a", "b"], ["c"]]);
  expect(out.partitionUnknownKeys).toEqual([out.items.find(i => i.source.kind === "unknown")!.key]);
  expect(out.items.some(i => i.source.kind === "reasoning_unavailable")).toBe(false);
});

it("maps authoritative v3 arrays without inventing item revision or splitting multi-link items", async () => {
  const { projectHistoryWindowItems } = await import("../src/conversation-items");
  const out = projectHistoryWindowItems({ revision: 7, nodes: [{ node_id: "A", selection: { ordinal: 2 }, items: [{ kind: "text", item_identity: "t", text: "prefix", text_complete: false }, { kind: "tool_call", item_identity: "c", execution_ids: ["x", "y"] }] }, { node_id: "B", selection: { ordinal: 3 }, items: [{ kind: "tool_result", item_identity: "r", execution_ids: ["x", "y"] }, { kind: "text", item_identity: "e", text: "", text_complete: true }] }] });
  expect(out.projection.items).toHaveLength(3);
  expect(out.projection.toolSummaries[0]?.executionIds).toEqual(["x", "y"]);
  expect(out.projection.items[0]?.source).toMatchObject({ text: "prefix", textComplete: false, windowRevision: 7 });
  expect(out.projection.items[0]?.source).not.toHaveProperty("revision");
});
it("keeps null/legacy ordinary nodes and ordinal retry outside fabricated item identity", async () => {
  const { projectHistoryWindowItems } = await import("../src/conversation-items");
  const out = projectHistoryWindowItems({ revision: "v", nodes: [{ node_id: "A", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "a", execution_ids: ["x"] }] }, { node_id: "B", selection: { ordinal: 1 }, items: null, items_unavailable_reason: "response_budget", excerpt: "ordinary retained" }, { node_id: "C", selection: { ordinal: 2 }, items: null, items_unavailable_reason: "response_budget" }] });
  expect(out.nodes).toHaveLength(3);
  expect(out.nodes[1]).toMatchObject({ nodeId: "B", state: "deferred", reason: "response_budget", ordinal: 1 });
  expect(out.retryFrom).toEqual({ ordinal: 1, expect_node_id: "B" });
  expect(out.projection.items).toHaveLength(1);
  expect(JSON.stringify(out.projection)).not.toContain("ordinary retained");
});

it("FINAL keeps empty ordinary presence without exposing reasoning or inventing item identity", () => {
  const out = projectHistoryWindowItems({ revision: "v", nodes: [
    { node_id: "user", kind: "user", items: [] },
    { node_id: "model", kind: "assistant_response", items: [{ kind: "reasoning_unavailable", item_identity: "r" }] },
    { node_id: "event", kind: "event", items: [] },
    { node_id: "empty-text", kind: "assistant_response", items: [{ kind: "text", item_identity: "t", text: "", text_complete: true }] },
    { node_id: "deferred", kind: "assistant_response", items: null, items_unavailable_reason: "response_budget", selection: { ordinal: 4 } },
  ] });
  expect(out.nodes.map(n => n.emptyOrdinary)).toEqual([true, true, false, false, false]);
  expect(out.projection.items.map(i => i.source.nodeId)).toEqual(["empty-text"]);
  expect(out.retryFrom).toEqual({ ordinal: 4, expect_node_id: "deferred" });
});
it("FINAL generic tool is visible without fictional execution or detail", () => {
  const out = projectSavedItems([{ nodeId: "A", itemIdentity: "tool", windowRevision: 1, kind: "tool", executionIds: [] }]);
  expect(out.items).toHaveLength(1);
  expect(out.items[0]?.key).toBe(JSON.stringify(["A", "tool"]));
  expect(out.items[0]?.source).toMatchObject({ kind: "tool", executionIds: [] });
  expect(out.toolSummaries[0]?.memberKeys).toEqual([out.items[0]!.key]);
  expect(out.toolSummaries[0]?.executionIds).toEqual([]);
});
it("FINAL summaries claim only local membership and retain uncertain edges", () => {
  const out = projectSavedItems([tool("A", "x", "x"), text("B", "e", ""), tool("C", "y", "y"), { nodeId: "C", itemIdentity: "u", revision: "r1", kind: "unknown" }, tool("D", "z", "z")]);
  expect(out.toolSummaries.map(s => [s.continuationBefore, s.continuationAfter])).toEqual([["unknown", "closed"], ["closed", "unknown"], ["unknown", "unknown"]]);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x"], ["y"], ["z"]]);
});
