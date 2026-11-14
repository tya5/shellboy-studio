import { expect, it } from "vitest";
import { projectSavedItems, type NormalizedSavedItem } from "../src/conversation-items";

const saved: NormalizedSavedItem = { nodeId: "node-1", itemIdentity: "node-1:/output/0/content/0", identityDomain: "node", windowRevision: 2, keyScope: ["thread/attempt/turn"], kind: "text", text: "saved", textComplete: true };
const live: NormalizedSavedItem = { domain: "live", namespace: "handoff", scope: "thread/attempt/turn", recordId: "handoff:attempt", attemptId: "attempt", canonicalNodeId: "node-1", canonicalScope: "thread/attempt/turn", kind: "text", text: "live" };

it("keeps the same projected row key while qualified live content becomes saved content", () => {
  const before = projectSavedItems([live]);
  const after = projectSavedItems([live, saved]);
  expect(before.items[0]?.key).toBe(after.items[0]?.key);
  expect(after.items).toHaveLength(1);
  expect(after.items[0]?.source.kind === "text" && after.items[0].source.text).toBe("saved");
});

it("does not join unknown, deleted, or differently owned facts", () => {
  const unknown: NormalizedSavedItem = { domain: "live", namespace: "handoff", scope: "thread/attempt/turn", recordId: "handoff:unknown", attemptId: "attempt", kind: "text", text: "preview" };
  const deleted: NormalizedSavedItem = { nodeId: "node-2", itemIdentity: "node-2:/output/0/content/0", identityDomain: "node", windowRevision: 2, keyScope: ["thread/attempt/turn"], kind: "text", text: "deleted", textComplete: true };
  const otherOwner: NormalizedSavedItem = { ...live, recordId: "handoff:other", scope: "other/attempt/turn", canonicalScope: "other/attempt/turn" };
  expect(projectSavedItems([unknown, deleted]).items.map(item => item.key)).toHaveLength(2);
  expect(projectSavedItems([otherOwner, saved]).items).toHaveLength(2);
});
