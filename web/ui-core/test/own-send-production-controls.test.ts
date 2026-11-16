import { describe, expect, it } from "vitest";
import { ownSendPresentation } from "../src/own-send-presentation";
import { projectSavedItems } from "../src/conversation-items";
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
    expect(decide(rows, [saved("b"), saved("a")]).retire).toEqual([]);
    expect(decide(rows, [saved("a"), saved("b")]).retire).toEqual(rows);
  });

  it("rejects foreign route/current and partial canonical bodies", () => {
    const row = local("a");
    expect(decide([row], [saved("a")], false).retire).toEqual([]);
    expect(decide([row], [saved("a", false)]).retire).toEqual([]);
  });
});
