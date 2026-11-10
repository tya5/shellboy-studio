import { describe, expect, it } from "vitest";
import { projectHistoryWindowItems, normalizeLiveWorkFacts } from "../src/conversation-items";
import type { HistoryItem, HistorySavedItem } from "../../data/src/protocol";
const text: HistorySavedItem = { kind: "text", item_identity: "body", text: "safe typed text", text_complete: true };
const call: HistorySavedItem = { kind: "tool_call", item_identity: "call", execution_ids: ["execution"] };
const reasoning: HistorySavedItem = { kind: "reasoning_unavailable", item_identity: "reason" };
const rows: readonly { name: string; node: HistoryItem; kind: string; semantic: string }[] = [
  { name: "01 user human", node: { kind: "user", provenance: { sender: { kind: "human" } }, items: [text] }, kind: "user", semantic: "conversation" },
  { name: "02 user model", node: { kind: "user", provenance: { sender: { kind: "model" } }, items: [text] }, kind: "user", semantic: "conversation" },
  { name: "03 user external_cli", node: { kind: "user", provenance: { sender: { kind: "external_cli" } }, items: [text] }, kind: "user", semantic: "conversation" },
  { name: "04 user unknown sender", node: { kind: "user", provenance: { sender: { kind: "unknown" } }, items: [text] }, kind: "user", semantic: "conversation" },
  { name: "05 assistant authoritative TEXT any phase", node: { kind: "assistant_response", phase: "arbitrary", items: [text] }, kind: "text", semantic: "conversation" },
  { name: "06 assistant tool_call function_call", node: { kind: "assistant_response", items: [call] }, kind: "tool", semantic: "work" },
  { name: "07 assistant reasoning readable contract absent", node: { kind: "assistant_response", items: [reasoning] }, kind: "reasoning_unavailable", semantic: "work" },
  { name: "08 encrypted opaque empty reasoning", node: { kind: "reasoning_unavailable", items: [] }, kind: "reasoning_unavailable", semantic: "work" },
  { name: "09 tool_result ordinary typed text is tool not unavailable", node: { kind: "tool_result", items: [text], executions: [{ execution_id: "execution" }] }, kind: "tool", semantic: "work" },
  { name: "10 spill", node: { kind: "spill", items: [], spill_tools: { status: "known", truncated: false, items: [{ call_id: "call", execution_id: "execution" }] } }, kind: "tool", semantic: "work" },
  { name: "11 summary", node: { kind: "summary", items: [text] }, kind: "summary", semantic: "conversation" },
  { name: "12 event", node: { kind: "event", items: [text] }, kind: "record", semantic: "work" },
  { name: "13 context context_note", node: { kind: "context_note", items: [text] }, kind: "record", semantic: "work" },
  { name: "14 model_stream_observation observation", node: { kind: "model_stream_observation", items: [text] }, kind: "record", semantic: "work" },
  { name: "15 message notification record", node: { kind: "message", items: [text] }, kind: "record", semantic: "work" },
  { name: "16 interruption_details", node: { kind: "interruption_details", items: [text] }, kind: "interruption", semantic: "work" },
  { name: "17 interruption_context", node: { kind: "interruption_context", items: [text] }, kind: "interruption", semantic: "work" },
  { name: "18 incomplete_response", node: { kind: "incomplete_response", items: [text] }, kind: "interruption", semantic: "work" },
  { name: "19 interrupted_wait", node: { kind: "interrupted_wait", items: [text] }, kind: "interruption", semantic: "work" },
  { name: "20 legacy assistant without safe text authority", node: { kind: "assistant", excerpt: "private aggregate" }, kind: "record", semantic: "work" },
  { name: "21 genuine unavailable actual reason", node: { kind: "assistant_response", items: null, items_unavailable_reason: "response_budget" }, kind: "unavailable", semantic: "work" },
  { name: "22 unknown bookkeeping internal", node: { kind: "future-internal", items: [text] }, kind: "record", semantic: "work" },
  { name: "23 definitively empty ordinary", node: { kind: "assistant_response", items: [] }, kind: "ordinaryEmpty", semantic: "conversation" },
];
describe("FINAL Section2 canonical node/item matrix", () => {
  for (const row of rows) it(`legacy crosspath ${row.name}`, async () => {
    const { materializeHistoryPresentation } = await import("../src/conversation");
    const result = materializeHistoryPresentation([{ node_id: "canonical-node", ...row.node, executions: [{ execution_id: "execution" }] }]).rows;
    if (row.semantic === "conversation") expect(result.some(entry => entry.type === "message" || entry.type === "note" && entry.kind === "ordinaryEmpty")).toBe(true);
    else expect(result.some(entry => entry.type === "note" && entry.kind === row.kind)).toBe(true);
    expect(result.some(entry => entry.type === "steps")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private aggregate");
  });

  for (const row of rows) it(row.name, () => {
    const out = projectHistoryWindowItems({ keyScope: ["owner", "thread"], revision: 1, nodes: [{ node_id: "node", ...row.node }] });
    expect(out.projection.items[0]?.source.kind).toBe(row.kind);
    expect(out.projection.sequence?.[0]?.kind).toBe(row.semantic);
    if (row.semantic === "work") expect(out.projection.workGroups).toHaveLength(1);
    if (row.kind === "interruption") expect(out.projection.workGroups?.[0]?.interrupted).toBe(true);
    if (!["tool"].includes(row.kind)) expect(out.projection.workGroups?.[0]?.toolItemKeys ?? []).toEqual([]);
    expect(JSON.stringify(out.projection)).not.toContain("private aggregate");
    if (row.kind === "unavailable") expect(out.projection.items[0]?.source).toMatchObject({ reason: "response_budget" });
  });
  it("24 pending accepted held INPUT is separate not Work", () => {
    expect(normalizeLiveWorkFacts({ scope: "thread", items: [{ id: "pending", kind: "message", state: "held", thread_id: "thread", message_id: "message" }] })).toEqual([]);
  });
  it("matrix aliases and arbitrary phase never create a second classification", async () => {
    const { classifySavedHistoryCase } = await import("../src/conversation-items");
    for (const kind of ["event", "context", "context_note", "model_stream_observation", "observation", "message", "notification", "unknown", "bookkeeping", "future"]) {
      expect(classifySavedHistoryCase(kind, "text").normalizedKind).toBe("record");
      expect(classifySavedHistoryCase(kind, "tool_call").normalizedKind).toBe("record");
    }
    for (const kind of ["assistant_response", "assistant"]) {
      expect(classifySavedHistoryCase(kind, "text").normalizedKind).toBe("text");
      expect(classifySavedHistoryCase(kind, "legacy").normalizedKind).toBe("record");
    }
  });
  it("BUG3 legacy ordinary tool remains tool without inventing unavailable body or successful execution", () => {
    const out = projectHistoryWindowItems({ revision: 1, nodes: [{ node_id: "tool", kind: "tool_result", excerpt: "do not parse aggregate", executions: [{ execution_id: "execution" }] }] });
    expect(out.projection.items[0]?.source).toMatchObject({ kind: "tool", executionIds: ["execution"] });
    expect(JSON.stringify(out.projection)).not.toContain("do not parse aggregate");
  });
});

it("legacy adapter preserves canonical Work identities without fabricated revisions or body authority", async () => {
  const { projectLegacyHistoryItems } = await import("../src/conversation-items");
  const out = projectLegacyHistoryItems({ nodes: [{ node_id: "event", kind: "event", excerpt: "private diagnostic" }, { node_id: "tool", kind: "tool_result", executions: [{ execution_id: "execution" }] }, { node_id: "interruption", kind: "interrupted_wait" }, { node_id: "human", kind: "user", excerpt: "literal human" }] });
  expect(out.projection.items.map(item => item.source.kind)).toEqual(["record", "tool", "interruption", "user"]);
  expect(out.projection.items.every(item => item.source.windowRevision === undefined && item.source.revision === undefined)).toBe(true);
  expect(out.projection.sequence?.map(row => row.kind)).toEqual(["work", "conversation"]);
  expect(JSON.stringify(out.projection)).not.toContain("private diagnostic");
});
it("legacy materializeHistoryPresentation publishes event/context identities and never arbitrary assistant aggregate", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  const rows = materializeHistoryPresentation([{ node_id: "event", kind: "event", excerpt: "private diagnostic" }, { node_id: "context", kind: "context" }, { node_id: "assistant", kind: "assistant_response", excerpt: "unproved prose" }]).rows;
  expect(rows.map(row => row.id)).toEqual(["event", "context", "assistant"]);
  expect(rows.every(row => row.type !== "message")).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("private diagnostic");
  expect(JSON.stringify(rows)).not.toContain("unproved prose");
});

it("crosspath event/context with execution sidefacts retain canonical record rows", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  for (const kind of ["event", "context"]) {
    const rows = materializeHistoryPresentation([{ node_id: kind, kind, excerpt: "private record payload", executions: [{ execution_id: "exec" }] }]).rows;
    expect(rows.some(row => row.type === "note" && row.id === kind && row.kind === "record")).toBe(true);
    expect(rows.some(row => row.type === "steps")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("private record payload");
  }
});
it("crosspath all interruption nodes retain markers alongside execution sidefacts", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  for (const kind of ["interruption_details", "interruption_context", "incomplete_response", "interrupted_wait"]) {
    const rows = materializeHistoryPresentation([{ node_id: kind, kind, executions: [{ execution_id: "exec" }] }]).rows;
    expect(rows.some(row => row.type === "note" && row.id === kind && row.kind === "interruption")).toBe(true);
    expect(rows.some(row => row.type === "steps")).toBe(true);
  }
});
it("crosspath typed assistant multi-item text needs no aggregate excerpt", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  const rows = materializeHistoryPresentation([{ node_id: "assistant", kind: "assistant_response", executions: [{ execution_id: "exec" }], items: [{ ...text, item_identity: "one", text: "one" }, { ...text, item_identity: "two", text: "two" }] }]).rows;
  expect(rows.filter(row => row.type === "message").map(row => row.text)).toEqual(["one", "two"]);
  expect(rows.some(row => row.type === "steps")).toBe(true);
});

it("canonical presentation exposes whole-input projection plus independent execution facts and provenance", async () => {
  const { materializeHistoryPresentation } = await import("../src/conversation");
  const input: HistoryItem[] = [{ node_id: "a", kind: "assistant_response", items: [{ ...text, item_identity: "one", text: "one" }, { ...text, item_identity: "two", text: "two" }], executions: [{ execution_id: "exec" }] }, { node_id: "b", kind: "event", items: [text], executions: [{ execution_id: "exec" }] }];
  const view = materializeHistoryPresentation(input);
  expect(view.projection.items).toHaveLength(3);
  expect(view.steps.map(step => step.executionId)).toEqual(["exec"]);
  expect(view.rows.filter(row => row.type === "message").map(row => row.text)).toEqual(["one", "two"]);
  expect(view.rows.every(row => view.nodeIdByRowId.has(row.id))).toBe(true);
  for (const row of view.rows.filter(row => row.type === "message" || row.type === "steps")) expect(view.nodeIdByRowId.get(row.id)).toBe("a");
  expect(view.rows.find(row => row.id === "b")).toMatchObject({ type: "note", kind: "record", text: "" });
});

// Independent specification-column expectations, not derived from product values.
const caseColumns = [
  ["human", "conversation", null, "human-message", "canonical"],
  ["receivedModel", "conversation", null, "received-model", "canonical"],
  ["receivedCli", "conversation", null, "received-cli", "canonical"],
  ["receivedUnknown", "conversation", null, "received-unknown", "canonical"],
  ["assistantText", "conversation", null, "model-message", "canonical"],
  ["toolCall", "work", "Tools", "tool", "association"],
  ["readableReasoning", "work", "Reasoning", "thinking", "canonical"],
  ["reasoningMarker", "work", "Reasoning", "thinking-marker", "canonical"],
  ["toolResult", "work", "Tools", "tool", "association"],
  ["spill", "work", "Tools", "compressed-tool", "association"],
  ["summary", "conversation", null, "summary", "canonical"],
  ["event", "work", "Notifications", "notification", "canonical"],
  ["context", "work", "Notifications", "state-change", "canonical"],
  ["observation", "work", "Notifications", "stream-change", "canonical"],
  ["notification", "work", "Notifications", "notification", "canonical"],
  ["childNotification", "work", "Notifications", "child-notification", "canonical"],
  ["shellNotification", "work", "Notifications", "shell-notification", "canonical"],
  ["interruptionDetails", "work", "Problems", "interruption", "canonical"],
  ["interruptionContext", "work", "Problems", "interruption", "canonical"],
  ["incompleteResponse", "work", "Problems", "interruption", "canonical"],
  ["interruptedWait", "work", "Problems", "interruption", "canonical"],
  ["legacyUnknown", "work", "Problems", "unsupported", "canonical"],
  ["unavailable", "work", "Problems", "unavailable", "canonical"],
  ["unknown", "work", "Problems", "unsupported", "canonical"],
  ["ordinaryEmpty", "conversation", null, "empty-ordinary", "canonical"],
] as const;
for (const [id, classification, headingCategory, render, keyPolicy] of caseColumns) it(`all columns canonical case ${id}`, async () => {
  const { CANONICAL_CASES } = await import("../src/conversation-items");
  expect(CANONICAL_CASES[id]).toMatchObject({ id, classification, headingCategory, render, keyPolicy, openPolicy: "closed", toolPolicy: keyPolicy === "association" ? "explicit-association" : "none" });
});
it("four Work category counts exclude duplicate associated tool rows and retain non-tool facts", async () => {
  const { projectHistoryWindowItems } = await import("../src/conversation-items");
  const out = projectHistoryWindowItems({ revision: 1, keyScope: ["owner", "thread"], nodes: [
    { node_id: "assistant", kind: "assistant_response", items: [call, { ...call, item_identity: "result", kind: "tool_result" }, reasoning] },
    { node_id: "event", kind: "event", items: [text] },
    { node_id: "problem", kind: "interrupted_wait", items: [] },
  ] });
  expect(out.projection.workGroups?.[0]?.categoryCounts).toEqual({ Tools: 1, Reasoning: 1, Notifications: 1, Problems: 1 });
  expect(out.projection.workGroups?.[0]?.interrupted).toBe(true);
});
it("qualified legacy boundary groups unversioned saved facts with explicitly live facts without public bypass", async () => {
  const { projectLegacyHistoryItems, projectSavedItems } = await import("../src/conversation-items");
  const mapped = projectLegacyHistoryItems({ nodes: [{ node_id: "event", kind: "event" }], liveFacts: [{ domain: "live", scope: "thread", recordId: "actual", kind: "record" }] });
  expect(mapped.projection.workGroups?.[0]?.memberKeys).toHaveLength(2);
  expect(mapped.projection.items[0]?.source).not.toHaveProperty("windowRevision");
  expect(() => projectSavedItems(mapped.projection.items.map(item => item.source))).toThrow();
  expect(() => projectLegacyHistoryItems({ nodes: [], liveFacts: [{ nodeId: "invented", itemIdentity: "invented", kind: "record" }] })).toThrow();
});

it("row04 missing structured sender is receivedUnknown, never inferred human from role or text", async () => {
  const { classifySavedHistoryCase, projectLegacyHistoryItems } = await import("../src/conversation-items");
  expect(classifySavedHistoryCase("user", "text").id).toBe("receivedUnknown");
  const out = projectLegacyHistoryItems({ nodes: [{ node_id: "user", kind: "user", excerpt: "human-looking Shellboy event text", items: [{ ...text }] }] });
  expect(out.projection.items[0]?.classification).toMatchObject({ id: "receivedUnknown", render: "received-unknown", classification: "conversation" });
  expect(out.nodes[0]?.node.provenance?.sender).toBeUndefined();
});

it("input case normalization happens before grouping and stored-column consumers reject missing cases", async () => {
  const { normalizeConversationFacts, canonicalItemCase, normalizeLiveWorkFacts } = await import("../src/conversation-items");
  expect(() => canonicalItemCase({ domain: "live", scope: "thread", recordId: "actual", kind: "record" })).toThrow();
  const normalized = normalizeConversationFacts([{ domain: "live", scope: "thread", recordId: "actual", kind: "user", text: "no sender proof" }]);
  expect(canonicalItemCase(normalized[0]!).id).toBe("receivedUnknown");
  const live = normalizeLiveWorkFacts({ scope: "thread", items: [{ id: "shell", thread_id: "thread", kind: "shell", state: "running", execution_id: "exec" }] });
  expect(live[0]?.classificationCase).toBe("toolCall");
  expect(normalizeConversationFacts(normalized)[0]?.classificationCase).toBe("receivedUnknown");
});
it("typed user and summary preserve explicit partial/completed facts through both projection boundaries", async () => {
  const { projectHistoryWindowItems, projectLegacyHistoryItems } = await import("../src/conversation-items");
  for (const kind of ["user", "summary"]) for (const complete of [false, true]) {
    const node: HistoryItem = { node_id: "node", kind, items: [{ ...text, text_complete: complete }] };
    for (const out of [projectHistoryWindowItems({ revision: 1, nodes: [node] }), projectLegacyHistoryItems({ nodes: [node] })]) {
      expect(out.projection.items[0]?.source).toMatchObject({ kind, text: text.text, textComplete: complete });
    }
  }
  const legacy = projectLegacyHistoryItems({ nodes: [{ node_id: "legacy", kind: "user", excerpt: "saved user" }] });
  expect(legacy.projection.items[0]?.source).not.toHaveProperty("textComplete");
});
