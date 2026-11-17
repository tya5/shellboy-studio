import { describe, expect, it } from "vitest";
import { ownSendPresentation } from "../src/own-send-presentation";
import { projectOwnedHandoffFacts, normalizeLiveWorkFacts, projectSavedItems } from "../src/conversation-items";
import type { PendingOwnMessage } from "../src/model";

const local = (id: string): PendingOwnMessage => ({ scope: "scope", threadId: "t", operationId: id, messageId: id, text: `Original ${id}`, phase: "accepted", plainMessageSend: true });
const saved = (id: string, textComplete = true) => ({ windowRevision: 1, nodeId: id, itemIdentity: id, kind: "user" as const, text: `Saved ${id}`, textComplete });

function decide(rows: readonly PendingOwnMessage[], savedRows: readonly ReturnType<typeof saved>[], current = true) {
  const projection = projectSavedItems(savedRows);
  return ownSendPresentation({ ref: {}, current, scope: "scope", projection, localRows: rows, hiddenItemKeys: new Set<string>(), canonicalRows: savedRows.map(row => ({ node_id: row.nodeId, kind: "user", items: [{ kind: "text" as const, item_identity: row.itemIdentity, text: row.text, text_complete: row.textComplete === true }] })) });
}

describe("ordinary own-send production controls", () => {
  it("keeps pending local rows visible until matching canonical order is accepted", () => {
    const rows = [local("a"), local("b")];
    expect(decide(rows, []).retire).toEqual([]);
    expect(decide(rows, [saved("b"), saved("a")]).retire).toEqual(rows);
    expect(decide(rows, [saved("a"), saved("b")]).retire).toEqual(rows);
  });

  it("keeps the saved canonical prefix and multiplicity when the own row is accepted", () => {
    const row = local("own");
    const savedRows = [saved("before"), saved("own"), saved("after")];
    const result = decide([row], savedRows);
    expect(result.retire).toEqual([row]);
    expect(result.projection.items.map(item => item.source.nodeId)).toEqual(["before", "own", "after"]);
    expect(result.projection.items.filter(item => item.source.nodeId === "own")).toHaveLength(1);
  });

  it("does not suppress issued live and Work facts for an ID-less sending row", () => {
    const idless = { ...local("sending"), messageId: undefined, phase: "sending" as const };
    const live = projectOwnedHandoffFacts("scope", [{ key: "handoff:live", attemptId: "live", text: "live assistant", incomplete: false, status: "streaming" }]);
    const work = normalizeLiveWorkFacts({ scope: "scope", items: [{ kind: "shell", state: "running", id: "receipt", thread_id: "scope", execution_id: "exec" }] });
    expect(live.every(item => !item.nodeId)).toBe(true);
    expect(work.every(item => !item.nodeId)).toBe(true);
    const projection = projectSavedItems([...live, ...work]);
    const result = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection,
      localRows: [idless], hiddenItemKeys: new Set<string>(), canonicalRows: [] });
    expect(result.localRows).toEqual([idless]);
    expect(result.retire).toEqual([]);
    expect(result.projection.items.every(item => "domain" in item.source && item.source.domain === "live")).toBe(true);
    expect(result.projection.items.map(item => "domain" in item.source ? item.source.recordId : undefined)).toEqual(["handoff:live", "receipt"]);
  });

  it("rejects foreign route/current and partial canonical bodies", () => {
    const row = local("a");
    expect(decide([row], [saved("a")], false).retire).toEqual([]);
    expect(decide([row], [saved("a", false)]).retire).toEqual([]);
  });
});
