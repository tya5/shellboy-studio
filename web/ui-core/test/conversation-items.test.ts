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
  it("does not treat hidden reasoning as body text or a group separator", () => {
    const out = projectSavedItems([tool("A", "x", "x"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning" }, tool("B", "y", "y")]);
    expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x", "y"]]);
    expect(out.items.some(i => i.source.kind === "reasoning")).toBe(false);
  });
  it("does not claim tool-run continuity through an unavailable ordered segment", () => {
    const out = projectSavedItems([tool("A", "x", "x"), { nodeId: "A", itemIdentity: "u", revision: "r1", kind: "unavailable" }, tool("B", "y", "y")]);
    expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x"], ["y"]]);
    expect(out.items[1]?.source.kind).toBe("unavailable");
  });
});
