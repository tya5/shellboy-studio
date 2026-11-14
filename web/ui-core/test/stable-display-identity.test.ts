// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { ComponentChildren } from "preact";
import type { ConversationWorkGroup } from "../../designs/console/screens/ConversationItems";
import { projectSavedItems, rekeyConversationPresentation, type NormalizedSavedItem } from "../src/conversation-items";

const saved: NormalizedSavedItem = { nodeId: "node-1", itemIdentity: "node-1:/output/0/content/0", identityDomain: "node", windowRevision: 2, kind: "text", text: "saved", textComplete: true };
const live: NormalizedSavedItem = { domain: "live", namespace: "handoff", scope: "thread/attempt/turn", recordId: "handoff:attempt", attemptId: "attempt", kind: "text", text: "live" };

it("keeps the same projected row key while qualified live content becomes saved content", () => {
  const before = projectSavedItems([live]);
  const savedProjection = projectSavedItems([saved]);
  const after = rekeyConversationPresentation(savedProjection, new Map([[savedProjection.items[0]!.key, before.items[0]!.key]]));
  expect(before.items[0]?.key).toBe(after.items[0]?.key);
  expect(after.items).toHaveLength(1);
  expect(after.items[0]?.source.kind === "text" && after.items[0].source.text).toBe("saved");
});

it("does not join unknown, deleted, or differently owned facts", () => {
  const unknown: NormalizedSavedItem = { domain: "live", namespace: "handoff", scope: "thread/attempt/turn", recordId: "handoff:unknown", attemptId: "attempt", kind: "text", text: "preview" };
  const deleted: NormalizedSavedItem = { nodeId: "node-2", itemIdentity: "node-2:/output/0/content/0", identityDomain: "node", windowRevision: 2, kind: "text", text: "deleted", textComplete: true };
  const otherOwner: NormalizedSavedItem = { ...live, recordId: "handoff:other", scope: "other/attempt/turn" };
  expect(projectSavedItems([unknown, deleted]).items.map(item => item.key)).toHaveLength(2);
  expect(projectSavedItems([otherOwner, saved]).items).toHaveLength(2);
});

it("keeps the rendered conversation container when the qualified row becomes saved", async () => {
  const { render, h } = await import("preact");
  const { ConversationItems } = await import("../../designs/console/screens/ConversationItems");
  const { Message } = await import("../../designs/console/system/components");
  const host = document.createElement("div");
  const liveProjection = projectSavedItems([live]);
  const row = (source: NormalizedSavedItem) => ({ key: projectSavedItems([source]).items[0]!.key, source });
  const renderProjection = (source: NormalizedSavedItem) => {
    const item = source === saved ? rekeyConversationPresentation(projectSavedItems([source]), new Map([[row(source).key, liveProjection.items[0]!.key]])).items[0]! : row(source);
    render(h(ConversationItems, { items: [item], sequence: [{ kind: "conversation", itemKey: item.key }], renderItem: () => h(Message, { bot: true, who: "Shellboy", text: source.kind === "text" ? source.text : "", copyLabel: "Copy", copiedLabel: "Copied" }) }), host);
  };
  renderProjection(live);
  const before = host.querySelector(".conversation-row");
  renderProjection(saved);
  const after = host.querySelector(".conversation-row");
  expect(before).not.toBeNull();
  expect(after).toBe(before);
  expect(after?.textContent).toContain("saved");
});

it("keeps duplicate canonical identities rejected while preserving node item multiplicity", () => {
  const second: NormalizedSavedItem = { ...saved, itemIdentity: "node-1:/output/0/content/1", text: "second" };
  expect(projectSavedItems([saved, second]).items).toHaveLength(2);
  expect(() => projectSavedItems([saved, saved])).toThrow("Duplicate normalized saved item identity");
});

it("keeps one answer container while preserving ordered canonical children", async () => {
  const { render, h } = await import("preact");
  const { ConversationItems } = await import("../../designs/console/screens/ConversationItems");
  const second: NormalizedSavedItem = { ...saved, itemIdentity: "node-1:/output/0/content/1", text: "second" };
  const base = projectSavedItems([saved, second]);
  const keys = new Map(base.items.map(item => [item.key, `answer:a1:${item.key}`]));
  const containers = new Map(base.items.map(item => [item.key, "answer:a1"]));
  const projection = rekeyConversationPresentation(base, keys, containers);
  const host = document.createElement("div");
  render(h(ConversationItems, { items: projection.items, sequence: projection.sequence, renderItem: item => h("span", {}, item.source.kind === "text" ? item.source.text : ""), workGroups: [], renderWorkGroup: (_group: ConversationWorkGroup, children: ComponentChildren) => children }), host);
  expect(host.querySelectorAll("[data-answer-container]")).toHaveLength(1);
  expect(host.querySelectorAll(".conversation-answer-child")).toHaveLength(2);
  expect(host.textContent).toContain("saved");
  expect(host.textContent).toContain("second");
});
