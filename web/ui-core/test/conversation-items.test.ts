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
  it.todo("reasoning-without-text transparency awaits the approved #296 short contract");
  it.todo("unavailable preserves partition uncertainty, not a confirmed body break or tool join");
  it.todo("same-revision evidence monotonicity and new-revision authorization require adapter proof");
});
