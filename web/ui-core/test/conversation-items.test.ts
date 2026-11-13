import { describe, expect, it } from "vitest";
import { projectHistoryWindowItems, projectSavedItems, type NormalizedSavedItem } from "../src/conversation-items";
const text = (nodeId: string, itemIdentity: string, value: string): NormalizedSavedItem => ({ nodeId, itemIdentity, revision: "r1", kind: "text", text: value });
const tool = (nodeId: string, itemIdentity: string, executionId: string): Extract<NormalizedSavedItem, { kind: "tool" }> => ({ nodeId, itemIdentity, revision: "r1", keyScope: ["test-owner", "test-thread"], kind: "tool", executionId });

describe("internal saved ordered-item projection (no wire adapter)", () => {
  it("splits on every body item, never on a node boundary", () => {
    const input = [text("A", "t", "before"), tool("A", "x", "x"), tool("B", "y", "y"), text("B", "t", "between"), tool("B", "z", "z")];
    const out = projectSavedItems(input);
    expect(out.items.map(i => i.source)).toMatchObject(input);
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
    const input: NormalizedSavedItem = { nodeId: "A", itemIdentity: "first", kind: "text", text: "changed", revision: "r2" };
    const after = projectSavedItems([input, text("A", "second", "same")]);
    expect(new Set(before.items.map(i => i.key)).size).toBe(2);
    expect(after.items.map(i => i.key)).toEqual(before.items.map(i => i.key));
    expect(after.items[0]?.source.revision).toBe("r2");
  });
  it("uses text items, including empty bodies, as explicit group boundaries", () => {
    const out = projectSavedItems([tool("A", "x", "x"), text("A", "empty", ""), tool("A", "y", "y")]);
    expect(out.items[1]?.source).toMatchObject(text("A", "empty", ""));
    expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x"], ["y"]]);
  });


  it.todo("same-revision evidence monotonicity and new-revision authorization require adapter proof");
});

it("materializes immutable data and preserves unknown partitions without reasoning text", () => {
  const source = [tool("A", "x", "x"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning", text: "must not leak" }, tool("B", "y", "y"), { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unavailable" }, tool("C", "z", "z")] as NormalizedSavedItem[];
  const out = projectSavedItems(source);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x", "y", "z"]]);
  expect(out.partitionUnknownKeys).toEqual([out.items[3]!.key]);
  expect(JSON.stringify(out)).not.toContain("must not leak");
  expect(Object.isFrozen(out)).toBe(true);
  expect(Object.isFrozen(out.items[0]?.source)).toBe(true);
  source.splice(0);
  expect(out.items).toHaveLength(5);
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

it("NEW FINAL reasoning and unknown are contentless Work members", () => {
  const out = projectSavedItems([tool("A", "a", "a"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning" }, tool("B", "b", "b"), { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unavailable" }, tool("C", "c", "c")]);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["a", "b", "c"]]);
  expect(out.items.some(i => i.source.kind === "reasoning")).toBe(true);
  expect(out.partitionUnknownKeys).toEqual([out.items.find(i => i.source.kind === "unavailable")!.key]);
});

it("NEW FINAL reasoning and unknown join Work without fabricating text", () => {
  const out = projectSavedItems([tool("A", "a", "a"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning_unavailable" }, tool("B", "b", "b"), { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unknown" }, text("C", "empty", ""), tool("C", "c", "c")]);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["a", "b"], ["c"]]);
  expect(out.partitionUnknownKeys).toEqual([out.items.find(i => i.source.kind === "unknown")!.key]);
  expect(out.items.some(i => i.source.kind === "reasoning_unavailable")).toBe(true);
});

it("maps authoritative v3 arrays without inventing item revision or splitting multi-link items", async () => {
  const { projectHistoryWindowItems } = await import("../src/conversation-items");
  const out = projectHistoryWindowItems({ keyScope: ["test-owner", "test-thread"], revision: 7, nodes: [{ node_id: "A", kind: "assistant_response", selection: { ordinal: 2 }, items: [{ kind: "text", item_identity: "t", text: "prefix", text_complete: false }, { kind: "tool_call", item_identity: "c", execution_ids: ["x", "y"] }] }, { node_id: "B", kind: "assistant_response", selection: { ordinal: 3 }, items: [{ kind: "tool_result", item_identity: "r", execution_ids: ["x", "y"] }, { kind: "text", item_identity: "e", text: "", text_complete: true }] }] });
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
  expect(out.projection.items).toHaveLength(3);
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
  expect(out.nodes.map(n => n.emptyOrdinary)).toEqual([true, false, false, false, false]);
  expect(out.projection.items.map(i => i.source.nodeId)).toEqual(["user", "model", "event", "empty-text", "deferred"]);
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
  expect(out.toolSummaries.map(s => [s.continuationBefore, s.continuationAfter])).toEqual([["unknown", "closed"], ["closed", "unknown"]]);
  expect(out.toolSummaries.map(s => s.executionIds)).toEqual([["x"], ["y", "z"]]);
});

it("FINAL legacy saved prose is independent of advisory publication state", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  const node = { node_id: "saved", kind: "assistant_response", phase: "commentary", excerpt: "Saved ordinary prose" };
  const baseline = materializeHistoryPresentation([node]).rows;
  for (const state of ["unknown", "tool"] as const) {
    expect(materializeHistoryPresentation([{ ...node, assistant_publication: { state, attemptId: "advisory" } }]).rows).toEqual(baseline);
  }
});
it("FINAL typed empty/unknown items never use aggregate excerpt as fallback", () => {
  const out = projectHistoryWindowItems({ revision: 1, nodes: [
    { node_id: "empty", kind: "assistant_response", excerpt: "aggregate must not render", items: [] },
    { node_id: "unknown", kind: "assistant_response", excerpt: "aggregate must not render", items: [{ kind: "unavailable", item_identity: "u", reason: "unsupported" }] },
  ] });
  expect(out.nodes[0]?.emptyOrdinary).toBe(true);
  expect(out.projection.items.map(i => i.source.kind)).toEqual(["ordinaryEmpty", "unavailable"]);
  expect(JSON.stringify(out.projection)).not.toContain("aggregate must not render");
});

it("FINAL execution-linked saved prose is invariant across phase and publication advice", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  const node = { node_id: "saved-linked", kind: "assistant_response", excerpt: "Same saved ordinary text", executions: [{ execution_id: "actual-execution", state: "exited", command_excerpt: "synthetic" }] };
  const baseline = materializeHistoryPresentation([node]).rows;
  expect(baseline.filter(row => row.type === "message")).toEqual([]);
  expect(baseline.some(row => row.type === "note" && row.kind === "record")).toBe(true);
  expect(baseline.filter(row => row.type === "steps")).toHaveLength(1);
  for (const phase of ["commentary", "final_answer", undefined, "unknown"]) {
    for (const advice of [undefined, "unknown", "tool"] as const) {
      const rows = materializeHistoryPresentation([{ ...node, ...(phase !== undefined ? { phase } : {}), ...(advice ? { assistant_publication: { state: advice, attemptId: "advisory" } } : {}) }]).rows;
      expect(rows).toEqual(baseline);
    }
  }
});
it("FINAL publication and execution hints cannot unlock typed empty or unavailable aggregate", () => {
  for (const items of [[], [{ kind: "unavailable" as const, item_identity: "u", reason: "unsupported" as const }]]) {
    const out = projectHistoryWindowItems({ revision: 1, nodes: [{ node_id: "typed", kind: "assistant_response", excerpt: "Forbidden aggregate", executions: [{ execution_id: "linked" }], assistant_publication: { state: "message", attemptId: "advisory" }, items }] });
    expect(out.projection.items.every(item => item.source.kind !== "text")).toBe(true);
    expect(JSON.stringify(out.projection)).not.toContain("Forbidden aggregate");
    expect(out.nodes[0]?.emptyOrdinary).toBe(items.length === 0);
  }
});

it("NEW FINAL groups every non-conversation record, including unknown/reasoning singleton", () => {
  const out = projectSavedItems([tool("A", "x", "x"), { nodeId: "A", itemIdentity: "r", revision: "r1", kind: "reasoning_unavailable" }, { nodeId: "B", itemIdentity: "u", revision: "r1", kind: "unknown" }, tool("B", "y", "y"), text("C", "t", ""), tool("D", "z", "z")]);
  expect(out.workGroups.map(g => g.memberKeys.length)).toEqual([4, 1]);
  expect(out.workGroups.map(g => g.executionIds)).toEqual([["x", "y"], ["z"]]);
  expect(out.sequence.map(row => row.kind)).toEqual(["work", "conversation", "work"]);
  expect(out.items).toHaveLength(6);
});
it("NEW FINAL no-ID work does not imply completed tools and prepend does not change content keys", () => {
  const member = { nodeId: "A", itemIdentity: "generic", revision: "r1", kind: "tool" as const, executionIds: [] };
  const out = projectSavedItems([member]);
  expect(out.workGroups[0]?.unknownToolCount).toBe(1);
  expect(out.workGroups[0]?.executionIds).toEqual([]);
  const prepended = projectSavedItems([tool("B", "b", "b"), member]);
  expect(prepended.items[1]?.key).toBe(out.items[0]?.key);
  expect(prepended.workGroups[0]?.key).not.toBe(out.workGroups[0]?.key);
});

it("NEW FINAL live identities are explicit scoped records, not fabricated saved nodes", async () => {
  const { normalizeLiveWorkFacts } = await import("../src/conversation-items");
  const live = normalizeLiveWorkFacts({ scope: "thread", items: [{ id: "shell-record", thread_id: "thread", kind: "shell", state: "running", execution_id: "actual" }, { id: "held", thread_id: "thread", kind: "message", state: "held", message_id: "pending" }, { id: "other", thread_id: "thread", kind: "other", state: "unknown", excerpt: "not body" }] });
  const out = projectSavedItems(live);
  expect(out.workGroups).toHaveLength(1);
  expect(out.workGroups[0]?.executionIds).toEqual(["actual"]);
  expect(out.items).toHaveLength(2);
  expect(out.items[0]?.source).not.toHaveProperty("nodeId");
  expect(JSON.stringify(out)).not.toContain("not body");
});

it("NEW FINAL handoff presence is nontext Work in a distinct explicit namespace", () => {
  const common = { domain: "live" as const, scope: "thread", recordId: "actual-record" };
  const out = projectSavedItems([{ ...common, kind: "record" }, { ...common, namespace: "handoff", kind: "unknown" }]);
  expect(out.items).toHaveLength(2);
  expect(new Set(out.items.map(item => item.key)).size).toBe(2);
  expect(out.workGroups).toHaveLength(1);
  expect(out.sequence.map(row => row.kind)).toEqual(["work"]);
  expect(out.items.every(item => !("text" in item.source))).toBe(true);
});

it("ATOMIC preserves explicit attempt/turn facts without changing live keys or inventing missing links", async () => {
  const { normalizeLiveWorkFacts } = await import("../src/conversation-items");
  const source = normalizeLiveWorkFacts({ scope: "thread", items: [{ id: "record", thread_id: "thread", kind: "shell", state: "running", execution_id: "exec", attempt_id: "attempt", turn_id: "turn" }, { id: "unlinked", thread_id: "thread", kind: "record", state: "unknown" }] });
  const out = projectSavedItems(source);
  expect(out.items[0]?.source).toMatchObject({ attemptId: "attempt", turnId: "turn" });
  expect(out.items[1]?.source).not.toHaveProperty("attemptId");
  expect(out.items[1]?.source).not.toHaveProperty("turnId");
  const handoff = projectSavedItems([{ domain: "live", namespace: "handoff", scope: "thread", recordId: "actual-key", attemptId: "attempt", kind: "text", text: "live" }]);
  expect(handoff.items[0]?.source).toMatchObject({ attemptId: "attempt", text: "live" });
  expect(handoff.items[0]?.key).toBe(JSON.stringify(["live", "handoff", "thread", "actual-key"]));
});

it("REVIEW budget reason survives into the visible Work item, not only node metadata", () => {
  const out = projectHistoryWindowItems({ revision: 1, nodes: [{ node_id: "budget", selection: { ordinal: 9 }, items: null, items_unavailable_reason: "response_budget", excerpt: "not safe body" }] });
  expect(out.projection.items[0]?.source).toMatchObject({ kind: "unavailable", reason: "response_budget", identityDomain: "node", nodeId: "budget" });
  expect(out.projection.workGroups?.[0]?.memberKeys).toEqual([out.projection.items[0]!.key]);
  expect(out.retryFrom).toEqual({ ordinal: 9, expect_node_id: "budget" });
  expect(JSON.stringify(out.projection)).not.toContain("not safe body");
});

it("SECTION11 scoped tool key and group survive non-tool prepend and selected call/result dedup", () => {
  const keyed = { ...tool("A", "call", "exec"), keyScope: ["owner", "thread"] };
  const first = projectSavedItems([keyed]);
  const next = projectSavedItems([{ nodeId: "R", itemIdentity: "reason", revision: "r1", kind: "reasoning" }, keyed, { ...tool("B", "result", "exec"), keyScope: ["owner", "thread"] }]);
  expect(next.workGroups[0]?.key).toBe(first.workGroups[0]?.key);
  expect(next.items.filter(i => i.source.kind === "tool")).toHaveLength(1);
  expect(first.items[0]?.key).toBe(JSON.stringify(["tool", ["owner", "thread"], "execution", ["exec"]]));
  expect(first.items[0]?.canonicalKey).toBe(JSON.stringify(["A", "call"]));
});
it("SECTION11 conflicting associations and missing IDs stay separate unresolved", () => {
  const out = projectSavedItems([{ ...tool("A", "a", "x"), executionIds: ["x", "y"], keyScope: ["o", "t"] }, { ...tool("B", "b", "x"), executionIds: ["x", "z"], keyScope: ["o", "t"] }, { nodeId: "C", itemIdentity: "c", revision: "r1", kind: "tool", executionIds: [] }]);
  expect(out.items).toHaveLength(3);
  expect(out.items.every(i => i.toolIdentity === "unresolved")).toBe(true);
});

it("SECTION11 unscoped equal IDs and unequal scoped associations never erase selected records", () => {
  const noScope = projectSavedItems([{ nodeId: "A", itemIdentity: "a", revision: "r", kind: "tool", executionIds: ["same"] }, { nodeId: "B", itemIdentity: "b", revision: "r", kind: "tool", executionIds: ["same"] }]);
  expect(noScope.items).toHaveLength(2);
  expect(noScope.items.every(item => item.toolIdentity === "unresolved")).toBe(true);
  const scopedCall = projectSavedItems([{ nodeId: "A", itemIdentity: "a", revision: "r", keyScope: ["owner", "thread", "attempt"], kind: "tool", callId: "call" }]);
  expect(scopedCall.items[0]?.toolIdentity).toBe("call");
  expect(scopedCall.items[0]?.key).toBe(JSON.stringify(["tool", ["owner", "thread", "attempt"], "call", "call"]));
});

it("F883 public selected spill association supplies the same tool row/key without private details", () => {
  const scope = ["owner", "thread"];
  const original = projectSavedItems([{ nodeId: "original", itemIdentity: "call-item", revision: "r1", keyScope: scope, kind: "tool", executionIds: ["exec"] }]);
  const out = projectHistoryWindowItems({ keyScope: scope, revision: 2, nodes: [{ node_id: "spill", kind: "spill", items: [], spill_tools: { status: "known", truncated: false, items: [{ call_id: "call", execution_id: "exec", original_node_id: "original" }] } }] });
  expect(out.projection.items).toHaveLength(1);
  expect(out.projection.items[0]?.key).toBe(original.items[0]?.key);
  expect(out.projection.items[0]?.source.nodeId).toBe("spill");
  expect(out.projection.items[0]?.source).toMatchObject({ kind: "tool", callId: "call", detailUnavailable: true, compressed: true });
  expect(out.projection.workGroups?.[0]?.executionIds).toEqual(["exec"]);
});
it("F883 spill call-only IDs remain usable while missing/truncated association stays honest", () => {
  const out = projectHistoryWindowItems({ keyScope: ["owner", "thread"], revision: 1, nodes: [{ node_id: "spill", kind: "spill", items: [], spill_tools: { status: "known", truncated: true, items: [{ call_id: "call" }] } }] });
  expect(out.projection.items[0]?.toolIdentity).toBe("call");
  expect(out.projection.items.some(item => item.source.kind === "unavailable")).toBe(true);
  expect(out.projection.workGroups?.[0]?.executionIds).toEqual([]);
});

it("F883 actually selected original and spill dedup preserves compressed badge without remapping provenance", () => {
  const out = projectHistoryWindowItems({ keyScope: ["owner", "thread"], revision: 1, nodes: [{ node_id: "original", kind: "assistant_response", items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] }, { node_id: "spill", kind: "spill", items: [], spill_tools: { status: "known", truncated: false, items: [{ call_id: "call", execution_id: "exec", original_node_id: "original" }] } }] });
  expect(out.projection.items).toHaveLength(1);
  expect(out.projection.items[0]?.source).toMatchObject({ nodeId: "original", kind: "tool", compressed: true });
});

it("F883 duplicate public spill facts are idempotent and conflicting calls remain unresolved", () => {
  const out = projectHistoryWindowItems({ keyScope: ["owner", "thread"], revision: 1, nodes: [{ node_id: "spill", kind: "spill", items: [], spill_tools: { status: "known", truncated: false, items: [{ call_id: "call", execution_id: "x" }, { call_id: "call", execution_id: "x" }, { call_id: "call", execution_id: "y" }] } }] });
  expect(out.projection.items).toHaveLength(2);
  expect(out.projection.items.every(item => item.toolIdentity === "unresolved")).toBe(true);
});

it("legacy canonical node presence needs no invented revision but grants no body or item authority", () => {
  const source = { identityDomain: "node" as const, nodeId: "actual-node", itemIdentity: "actual-node", kind: "unknown" as const };
  const out = projectSavedItems([source]);
  expect(out.items[0]?.source).toMatchObject(source);
  expect(out.sequence.map(row => row.kind)).toEqual(["work"]);
  expect(out.items[0]?.key).toBe(JSON.stringify(["node", "actual-node"]));
  expect(() => projectSavedItems([{ ...source, kind: "text", text: "unproved" }])).toThrow();
  expect(() => projectSavedItems([{ ...source, itemIdentity: "guessed-item" }])).toThrow();
});

it("USER970c1 node kind outranks developer input text: event/context stay Work records", () => {
  for (const kind of ["event", "context", "other-internal", undefined]) {
    const out = projectHistoryWindowItems({ revision: 1, nodes: [{ node_id: kind ?? "missing-kind", kind, provenance: { sender: { kind: "developer" } }, items: [{ kind: "text", item_identity: "input", text: "developer input_text", text_complete: true }] }] });
    expect(out.projection.items[0]?.source.kind).toBe("record");
    expect(out.projection.sequence?.map(row => row.kind)).toEqual(["work"]);
    expect(JSON.stringify(out.projection)).not.toContain("developer input_text");
  }
});
it("USER970c1 user literal event/context text and typed assistant text remain Conversation", () => {
  const out = projectHistoryWindowItems({ revision: 1, nodes: [
    { node_id: "human", kind: "user", items: [{ kind: "text", item_identity: "body", text: "Shellboy event/context is literal human text", text_complete: true }] },
    { node_id: "received", kind: "user", provenance: { sender: { kind: "thread", thread_id: "source" } }, items: [{ kind: "text", item_identity: "body", text: "legitimate received user", text_complete: true }] },
    { node_id: "assistant", kind: "assistant_response", phase: "any", items: [{ kind: "text", item_identity: "body", text: "assistant text", text_complete: true }] },
  ] });
  expect(out.projection.sequence?.map(row => row.kind)).toEqual(["conversation", "conversation", "conversation"]);
  expect(out.projection.items.map(item => "text" in item.source ? item.source.text : undefined)).toEqual(["Shellboy event/context is literal human text", "legitimate received user", "assistant text"]);
  expect(out.nodes[1]?.node.provenance?.sender?.kind).toBe("thread");
});

it.each([['run', 'live'], ['run', 'stopping'], ['turn', 'preparing'], ['turn', 'running'], ['turn', 'waiting']])('issues supported live activity CASE for %s/%s without inventing a problem', async (kind, state) => {
  const { normalizeLiveWorkFacts, scopeIssuedWorkFacts } = await import('../src/conversation-items');
  const facts = normalizeLiveWorkFacts({ scope: 'thread', items: [{ kind, state, id: 'activity', thread_id: 'thread' }] });
  const scoped = scopeIssuedWorkFacts(facts, ['owner', 'thread'])!;
  const out = projectSavedItems(scoped);
  expect(out.items[0]!.classification).toMatchObject({ id: 'liveActivity', headingCategory: 'Notifications', toolPolicy: 'none' });
  expect(out.workGroups[0]!.categoryCounts).toEqual({ Tools: 0, Reasoning: 0, Notifications: 1, Problems: 0 });
  expect(out.workGroups[0]!.executionIds).toEqual([]);
  expect(out.items[0]!.source).toMatchObject({ domain: 'live', scope: 'thread', recordId: 'activity' });
  expect(out.items[0]!.key).toBe(projectSavedItems(facts).items[0]!.key);
  expect(scopeIssuedWorkFacts([{ ...facts[0]! }], ['owner', 'thread'])).toBeUndefined();
});

it.each([['turn', 'live'], ['run', 'running'], ['turn', 'recovery_wait'], ['run', 'failed'], ['turn', 'completed'], ['turn', 'future'], ['future', 'running']])('preserves genuine unknown/problem live state %s/%s', async (kind, state) => {
  const { normalizeLiveWorkFacts } = await import('../src/conversation-items');
  const out = projectSavedItems(normalizeLiveWorkFacts({ scope: 'thread', items: [{ kind, state, id: 'odd', thread_id: 'thread' }] }));
  expect(out.items[0]!.classification).toMatchObject({ id: 'unknown', headingCategory: 'Problems' });
});

it('does not reinterpret saved run or turn records as transient activity', () => {
  const out = projectHistoryWindowItems({ revision: 1, nodes: [{ node_id: 'saved-run', kind: 'run' }, { node_id: 'saved-turn', kind: 'turn' }] });
  expect(out.projection.items.map(item => item.classification!.id)).toEqual(['unknown', 'unknown']);
});

it('activity issuance rejects invalid identity and foreign Thread scope', async () => {
  const { normalizeLiveWorkFacts } = await import('../src/conversation-items');
  for (const item of [{kind:'turn',state:'running',id:'',thread_id:'thread'}, {kind:'turn',state:'running',id:'a',thread_id:'foreign'}]) {
    expect(() => normalizeLiveWorkFacts({scope:'thread',items:[item]})).toThrow('Invalid live work scope');
  }
});
