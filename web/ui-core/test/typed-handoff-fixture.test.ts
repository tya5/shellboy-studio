import { expect, it } from "vitest";
import { typedAttempt, typedHandoff, typedHistoryWindow, validTypedHandoff } from "./typed-handoff-fixture";

it("builds one strict receipt/owner history contract for node and ordinal reads", () => {
  const fixture = typedHandoff();
  const attempt = typedAttempt(fixture);
  const byNode = typedHistoryWindow(fixture, { node_id: fixture.nodeId });
  const byOrdinal = typedHistoryWindow(fixture, { ordinal: fixture.ordinal });
  expect(byNode).toEqual(byOrdinal);
  expect(byNode && validTypedHandoff(fixture, attempt, byNode)).toBe(true);
  expect(byNode?.items[0]?.items[0]?.text_complete).toBe(true);
  expect(byNode?.item_count).toBe(1);
});

it("rejects mismatched receipt identity and node ordinal", () => {
  const fixture = typedHandoff();
  const attempt = typedAttempt(fixture);
  const window = typedHistoryWindow(fixture, { node_id: fixture.nodeId })!;
  expect(validTypedHandoff(fixture, { ...attempt, response_nodes: [{ ...attempt.response_nodes[0], ordinal: 299 }] }, window)).toBe(false);
  expect(validTypedHandoff(fixture, attempt, { ...window, items: [{ ...window.items[0], selection: { ordinal: 299 } }] })).toBe(false);
  expect(typedHistoryWindow(fixture, { node_id: "wrong-node" })).toBeUndefined();
  expect(typedHistoryWindow(fixture, { ordinal: 299 })).toBeUndefined();
});

it('routes registry refs exactly and keeps deferred body until canonical publication', () => {
  const registry = typedHandoffRegistry({threadId:'thread',attemptId:'attempt',turnId:'turn',revision:7,total:4,refs:[{nodeId:'n2',ordinal:2,text:'A'},{nodeId:'n3',ordinal:3,text:'B'}]});
  expect(registry.scope).toBe('thread/attempt/turn');
  expect(registry.history({})).toBeUndefined();
  expect(registry.history({node_id:'n3', ordinal:3})?.items[0]?.items[0]?.text).toBe('');
  registry.canonical = true;
  expect(registry.history({node_id:'n3', ordinal:3})?.items[0]?.items[0]?.text).toBe('B');
  expect(() => typedHandoffRegistry({threadId:'t',attemptId:'a',turnId:'u',revision:1,total:2,refs:[{nodeId:'x',ordinal:1,text:'x'},{nodeId:'y',ordinal:1,text:'y'}]})).toThrow();
});
