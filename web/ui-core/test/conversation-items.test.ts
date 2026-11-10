import { describe, expect, it } from "vitest";
import { projectSavedItems, type NormalizedSavedItem } from "../src/conversation-items";
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
