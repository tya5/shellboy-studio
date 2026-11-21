import { describe, expect, it } from "vitest";
import { ownSendPresentation, ownSendRowKey } from "../src/own-send-presentation";
import { projectOwnedHandoffFacts, normalizeLiveWorkFacts, projectSavedItems } from "../src/conversation-items";
import type { PendingOwnMessage } from "../src/model";

const local = (id: string): PendingOwnMessage => ({ scope: "scope", threadId: "t", operationId: id, messageId: id, text: `Original ${id}`, phase: "accepted", plainMessageSend: true, clientOrdinal: Number(id.charCodeAt(0)) });
const saved = (id: string, textComplete = true) => ({ windowRevision: 1, nodeId: id, itemIdentity: id, kind: "user" as const, text: `Saved ${id}`, textComplete });

function rowIds(result: ReturnType<typeof decide>): string[] {
  const savedIds = (result.projection.sequence ?? []).flatMap(entry => {
    if (entry.kind !== "conversation") return [];
    const item = result.projection.items.find(candidate => candidate.key === entry.itemKey);
    return item?.source.nodeId ? [item.source.nodeId] : [];
  });
  return [...savedIds, ...result.tailRows.map(row => row.kind === "live"
    ? ("attemptId" in row.item.source ? String(row.item.source.attemptId) : "")
    : String(row.row.messageId ?? row.row.operationId))];
}

function decide(rows: readonly PendingOwnMessage[], savedRows: readonly ReturnType<typeof saved>[], current = true, liveOrdinals = new Map<string, number>()) {
  const projection = projectSavedItems(savedRows);
  return ownSendPresentation({ ref: {}, current, scope: "scope", projection, localRows: rows, canonicalRows: savedRows.map(row => ({ node_id: row.nodeId, kind: "user", items: [{ kind: "text" as const, item_identity: row.itemIdentity, text: row.text, text_complete: row.textComplete === true }] })), liveOrdinals });
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


  it("keeps a send after a response already streaming through saved adoption", () => {
    const pending = { ...local("P"), clientOrdinal: 2 };
    const live = projectOwnedHandoffFacts("scope", [{ key: "handoff:r0", attemptId: "R0", text: "streaming", incomplete: false, status: "streaming" }]);
    const beforeProjection = projectSavedItems([saved("H"), ...live]);
    const before = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: beforeProjection,
      localRows: [pending], canonicalRows: [], liveOrdinals: new Map([["R0", 1]]) });
    expect(rowIds(before)).toEqual(["H", "R0", "P"]);
    const pendingKey = ownSendRowKey(pending.messageId!);

    const afterRows = [saved("H"), saved("R0"), saved("P")];
    const liveNext = projectOwnedHandoffFacts("scope", [{ key: "handoff:r1", attemptId: "R1", text: "next", incomplete: false, status: "streaming" }]);
    const afterProjection = projectSavedItems([...afterRows, ...liveNext]);
    const afterDecision = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: afterProjection,
      localRows: [pending], canonicalRows: afterRows.map(row => ({ node_id: row.nodeId, kind: "user", items: [{ kind: "text" as const, item_identity: row.itemIdentity, text: row.text, text_complete: true }] })), liveOrdinals: new Map([["R1", 4]]) });
    expect(afterDecision.retire).toEqual([pending]);
    expect(rowIds(afterDecision)).toEqual(["H", "R0", "P", "R1"]);
    const adopted = afterDecision.projection.items.find(item => item.source.nodeId === "P")!;
    expect(ownSendRowKey(adopted.source.nodeId!)).toBe(pendingKey);
    expect(rowIds(afterDecision).indexOf("P")).toBe(rowIds(before).indexOf("P"));
  });

  it("orders successive own sends by client ordinal and keeps a held send after the live attempt", () => {
    const first = { ...local("P1"), clientOrdinal: 2 };
    const second = { ...local("P2"), clientOrdinal: 3 };
    const held = { ...local("held"), phase: "unconfirmed" as const, clientOrdinal: 2 };
    const live = projectOwnedHandoffFacts("scope", [{ key: "handoff:r0", attemptId: "R0", text: "streaming", incomplete: false, status: "streaming" }]);
    const multiple = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: projectSavedItems([saved("H"), ...live]),
      localRows: [second, first], canonicalRows: [], liveOrdinals: new Map([["R0", 1]]) });
    expect(rowIds(multiple)).toEqual(["H", "R0", "P1", "P2"]);
    const adoptedFirstRows = [saved("H"), saved("R0"), saved("P1")];
    const adoptedFirst = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: projectSavedItems(adoptedFirstRows),
      localRows: [first, second], canonicalRows: adoptedFirstRows.map(row => ({ node_id: row.nodeId, kind: "user", items: [{ kind: "text" as const, item_identity: row.itemIdentity, text: row.text, text_complete: true }] })), liveOrdinals: new Map([["R0", 1]]) });
    expect(adoptedFirst.retire).toEqual([first]);
    expect(rowIds(adoptedFirst)).toEqual(["H", "R0", "P1", "P2"]);
    const adoptedBothRows = [saved("H"), saved("R0"), saved("P1"), saved("P2")];
    const adoptedBoth = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: projectSavedItems(adoptedBothRows),
      localRows: [first, second], canonicalRows: adoptedBothRows.map(row => ({ node_id: row.nodeId, kind: "user", items: [{ kind: "text" as const, item_identity: row.itemIdentity, text: row.text, text_complete: true }] })) });
    expect(adoptedBoth.retire).toEqual([first, second]);
    expect(rowIds(adoptedBoth)).toEqual(["H", "R0", "P1", "P2"]);
    const stopped = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: projectSavedItems([saved("H"), ...live]),
      localRows: [held], canonicalRows: [], liveOrdinals: new Map([["R0", 1]]) });
    expect(rowIds(stopped)).toEqual(["H", "R0", "held"]);
    const savedHeld = { ...held, phase: "accepted" as const, messageId: "held" };
    const afterStop = [saved("H"), saved("R0"), saved("held")];
    const stoppedAdopted = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection: projectSavedItems(afterStop),
      localRows: [savedHeld], canonicalRows: afterStop.map(row => ({ node_id: row.nodeId, kind: "user", items: [{ kind: "text" as const, item_identity: row.itemIdentity, text: row.text, text_complete: true }] })) });
    expect(stoppedAdopted.retire).toEqual([savedHeld]);
    expect(rowIds(stoppedAdopted)).toEqual(["H", "R0", "held"]);
    expect(ownSendRowKey(stoppedAdopted.retire[0]!.messageId!)).toBe("own:held");
  });


  it("does not suppress issued live and Work facts for an ID-less sending row", () => {
    const idless = { ...local("sending"), messageId: undefined, phase: "sending" as const };
    const live = projectOwnedHandoffFacts("scope", [{ key: "handoff:live", attemptId: "live", text: "live assistant", incomplete: false, status: "streaming" }]);
    const work = normalizeLiveWorkFacts({ scope: "scope", items: [{ kind: "shell", state: "running", id: "receipt", thread_id: "scope", execution_id: "exec" }] });
    expect(live.every(item => !item.nodeId)).toBe(true);
    expect(work.every(item => !item.nodeId)).toBe(true);
    const projection = projectSavedItems([...live, ...work]);
    const result = ownSendPresentation({ ref: {}, current: true, scope: "scope", projection,
      localRows: [idless], canonicalRows: [] });
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
