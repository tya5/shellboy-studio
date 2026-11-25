// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { ComponentChildren } from "preact";
import type { ConversationWorkGroup } from "../screens/ConversationItems";
import { projectSavedItems, withPresentationContainers, type NormalizedSavedItem } from "../../../ui-core/src/conversation-items";

const saved: NormalizedSavedItem = { nodeId: "node-1", itemIdentity: "node-1:/output/0/content/0", identityDomain: "node", windowRevision: 2, kind: "text", text: "saved", textComplete: true };
const live: NormalizedSavedItem = { domain: "live", namespace: "handoff", scope: "thread/attempt/turn", recordId: "handoff:attempt", attemptId: "attempt", kind: "text", text: "live" };

it("keeps canonical saved identity separate while assigning the qualified host", () => {
  const before = projectSavedItems([live]);
  const savedProjection = projectSavedItems([saved]);
  const after = withPresentationContainers(savedProjection, new Map([[savedProjection.items[0]!.key, "answer:handoff"]]));
  expect(before.items[0]?.key).not.toBe(after.items[0]?.key);
  expect((after.items[0] as typeof after.items[0] & { presentationContainer?: string }).presentationContainer).toBe("answer:handoff");
  expect(after.items).toHaveLength(1);
  expect(after.items[0]?.source.kind === "text" && after.items[0].source.text).toBe("saved");
});

it("keeps canonical keys and sequence authoritative while assigning only the host", () => {
  const second: NormalizedSavedItem = { ...saved, itemIdentity: "node-1:/output/0/content/1", text: "second" };
  const base = projectSavedItems([saved, second]);
  const result = withPresentationContainers(base, new Map(base.items.map(item => [item.key, "answer:attempt-1"])));
  expect(result.items.map(item => item.key)).toEqual(base.items.map(item => item.key));
  expect(result.sequence).toEqual(base.sequence);
  expect(result.items.map(item => (item as typeof item & { presentationContainer?: string }).presentationContainer)).toEqual(["answer:attempt-1", "answer:attempt-1"]);
});

it("preserves nonadjacent canonical sequence and intervening work authority", () => {
  const second: NormalizedSavedItem = { ...saved, nodeId: "node-2", itemIdentity: "node-2:/output/0/content/0", text: "second" };
  const base = projectSavedItems([saved, second]);
  const sequence = [{ kind: "conversation" as const, itemKey: base.items[0]!.key }, { kind: "work" as const, groupKey: "work-1" }, { kind: "conversation" as const, itemKey: base.items[1]!.key }];
  const result = withPresentationContainers({ ...base, sequence }, new Map(base.items.map(item => [item.key, "answer:attempt-1"])));
  expect(result.sequence).toEqual(sequence);
  expect(result.items.map(item => item.key)).toEqual(base.items.map(item => item.key));
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
  const { ConversationItems } = await import("../screens/ConversationItems");
  const { Message } = await import("../system/components/Message");
  const host = document.createElement("div");
  const liveProjection = projectSavedItems([live]);
  const row = (source: NormalizedSavedItem) => ({ key: projectSavedItems([source]).items[0]!.key, source });
  const renderProjection = (source: NormalizedSavedItem) => {
    const item = source === saved ? withPresentationContainers(projectSavedItems([source]), new Map([[row(source).key, "answer:handoff"]])).items[0]! : row(source);
    render(h(ConversationItems, { items: [item], sequence: [{ kind: "conversation", itemKey: item.key }], renderItem: () => h(Message, { bot: true, who: "Shellboy", text: source.kind === "text" ? source.text : "", copyLabel: "Copy", copiedLabel: "Copied" }) }), host);
  };
  const liveWithContainer = withPresentationContainers(liveProjection, new Map([[liveProjection.items[0]!.key, "answer:handoff"]]));
  render(h(ConversationItems, { items: liveWithContainer.items, sequence: liveWithContainer.sequence, renderItem: () => h(Message, { bot: true, who: "Shellboy", text: "live", copyLabel: "Copy", copiedLabel: "Copied" }) }), host);
  const before = host.querySelector("[data-answer-container]");
  renderProjection(saved);
  const after = host.querySelector("[data-answer-container]");
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
  const { ConversationItems } = await import("../screens/ConversationItems");
  const second: NormalizedSavedItem = { ...saved, itemIdentity: "node-1:/output/0/content/1", text: "second" };
  const base = projectSavedItems([saved, second]);
  const containers = new Map(base.items.map(item => [item.key, "answer:a1"]));
  const projection = withPresentationContainers(base, containers);
  const host = document.createElement("div");
  render(h(ConversationItems, { items: projection.items, sequence: projection.sequence, renderItem: item => h("span", {}, item.source.kind === "text" ? item.source.text : ""), workGroups: [], renderWorkGroup: (_group: ConversationWorkGroup, children: ComponentChildren) => children }), host);
  expect(host.querySelectorAll("[data-answer-container]")).toHaveLength(1);
  expect(host.querySelectorAll(".conversation-answer-child")).toHaveLength(2);
  expect(host.textContent).toContain("saved");
  expect(host.textContent).toContain("second");
});

it("renders one stable host for nonadjacent children while preserving intervening work order", async () => {
  const { render, h } = await import("preact");
  const { ConversationItems } = await import("../screens/ConversationItems");
  const host = document.createElement("div"); document.body.append(host);
  const second: NormalizedSavedItem = { ...saved, nodeId: "node-2", itemIdentity: "node-2:/output/0/content/0", text: "second" };
  const base = projectSavedItems([saved, second]);
  const projection = withPresentationContainers(base, new Map(base.items.map(item => [item.key, "answer:attempt-1"])));
  try {
    render(h(ConversationItems, {
      items: projection.items,
      sequence: [{ kind: "conversation", itemKey: base.items[0]!.key }, { kind: "work", groupKey: "work-1" }, { kind: "conversation", itemKey: base.items[1]!.key }],
      workGroups: [{ key: "work-1", firstMemberKey: "work-1", memberKeys: [], executionIds: [], toolItemKeys: [], unknownToolCount: 0, interrupted: false }],
      renderItem: item => h("span", {}, item.source.kind === "text" ? item.source.text : ""), renderWorkGroup: (_group, children) => h("div", { class: "intervening-work", "data-work-marker": "other-attempt-work" }, [h("span", {}, "other-attempt-work"), children]),
    }), host);
    expect(host.querySelectorAll("[data-answer-container]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-answer-container] [data-item-key]")).toHaveLength(2);
    expect([...host.querySelectorAll("[data-item-key], [data-work-marker], [data-local-marker]")].map(node => node.textContent?.trim())).toEqual(["saved", "other-attempt-work", "second"]);
  } finally { render(null, host); host.remove(); }
});

it("does not host an unowned conversation inside an association span", async () => {
  const { render, h } = await import("preact");
  const { ConversationItems } = await import("../screens/ConversationItems");
  const host = document.createElement("div");
  const human: NormalizedSavedItem = { ...saved, nodeId: "node-human", itemIdentity: "node-human:/output/0/content/0", text: "human" };
  const third: NormalizedSavedItem = { ...saved, nodeId: "node-3", itemIdentity: "node-3:/output/0/content/0", text: "third" };
  const base = projectSavedItems([saved, human, third]);
  const projection = withPresentationContainers(base, new Map([[base.items[0]!.key, "answer:a"], [base.items[2]!.key, "answer:a"]]));
  try {
    render(h(ConversationItems, { items: projection.items, sequence: base.items.map(item => ({ kind: "conversation" as const, itemKey: item.key })), renderItem: item => h("span", {}, item.source.kind === "text" ? item.source.text : "") }), host);
    expect(host.querySelectorAll("[data-answer-container]")).toHaveLength(0);
    expect([...host.querySelectorAll("[data-item-key]")].map(node => node.textContent)).toEqual(["saved", "human", "third"]);
  } finally { render(null, host); }
});

it("keeps crossing associations unqualified without reordering canonical data", async () => {
  const { render, h } = await import("preact");
  const { ConversationItems } = await import("../screens/ConversationItems");
  const host = document.createElement("div"); document.body.append(host);
  const second: NormalizedSavedItem = { ...saved, nodeId: "node-2", itemIdentity: "node-2:/output/0/content/0", text: "second" };
  const third: NormalizedSavedItem = { ...saved, nodeId: "node-3", itemIdentity: "node-3:/output/0/content/0", text: "third" };
  const base = projectSavedItems([saved, second, third]);
  const containers = new Map([[base.items[0]!.key, "answer:a"], [base.items[1]!.key, "answer:b"], [base.items[2]!.key, "answer:a"]]);
  const projection = withPresentationContainers(base, containers);
  try {
    render(h(ConversationItems, { items: projection.items, sequence: base.items.map(item => ({ kind: "conversation" as const, itemKey: item.key })), renderItem: item => h("span", {}, item.source.kind === "text" ? item.source.text : "") }), host);
    expect(host.querySelectorAll('[data-answer-container="answer:a"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-answer-container="answer:b"]')).toHaveLength(0);
    expect([...host.querySelectorAll("[data-item-key]")].map(node => node.textContent)).toEqual(["saved", "second", "third"]);
  } finally { render(null, host); host.remove(); }
});
