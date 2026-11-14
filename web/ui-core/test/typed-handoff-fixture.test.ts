import { expect, it } from "vitest";
import { typedAttempt, typedHandoff, typedHistoryWindow, validTypedHandoff, typedHandoffRegistry,typedSelectedCoverageWindow } from "./typed-handoff-fixture";

it("builds one strict receipt/owner history contract for node and ordinal reads", () => {
  const fixture = typedHandoff();
  const attempt = typedAttempt(fixture);
  const byNode = typedHistoryWindow(fixture, { node_id: fixture.nodeId });
  const byOrdinal = typedHistoryWindow(fixture, { ordinal: fixture.ordinal });
  expect(byNode).toEqual(byOrdinal);
  expect(byNode && validTypedHandoff(fixture, attempt, byNode)).toBe(true);
  expect(byNode!.items[0]!.items![0]!.text_complete).toBe(true);
  expect(byNode!.item_count).toBe(1);
});

it("rejects mismatched receipt identity and node ordinal", () => {
  const fixture = typedHandoff();
  const attempt = typedAttempt(fixture);
  const window = typedHistoryWindow(fixture, { node_id: fixture.nodeId })!;
  expect(validTypedHandoff(fixture, { ...attempt, response_nodes: [{...attempt.response_nodes[0]!,ordinal:299}] }, window)).toBe(false);
  expect(validTypedHandoff(fixture, attempt, { ...window, items: [{ ...window.items[0]!, selection: { ordinal: 299 } }] })).toBe(false);
  expect(typedHistoryWindow(fixture, { node_id: "wrong-node" })).toBeUndefined();
  expect(typedHistoryWindow(fixture, { ordinal: 299 })).toBeUndefined();
});

it('routes registry refs exactly and keeps deferred body until canonical publication', () => {
  const registry = typedHandoffRegistry({threadId:'thread',attemptId:'attempt',turnId:'turn',revision:7,total:4,refs:[{nodeId:'n2',ordinal:2,text:'A'},{nodeId:'n3',ordinal:3,text:'B'}]});
  expect(registry.scope).toBe('thread/attempt/turn');
  expect(registry.history({})).toBeUndefined();
  expect(registry.history({node_id:'n3', ordinal:3})?.items[0]?.items).toBeNull();
  registry.canonical = true;
  expect(registry.history({node_id:'n3', ordinal:3})!.items[0]!.items![0]?.text).toBe('B');
  expect(() => typedHandoffRegistry({threadId:'t',attemptId:'a',turnId:'u',revision:1,total:2,refs:[{nodeId:'x',ordinal:1,text:'x'},{nodeId:'y',ordinal:1,text:'y'}]})).toThrow();
});

it("rejects stale revision/total and preserves bounded budget/deletion evidence", () => {
  const fixture = typedHandoff({ revision: 8, total: 4 });
  const attempt = typedAttempt(fixture);
  const window = typedHistoryWindow(fixture, { node_id: fixture.nodeId })!;
  expect(validTypedHandoff(fixture, attempt, window)).toBe(true);
  expect(validTypedHandoff({ ...fixture, revision: 7 }, attempt, window)).toBe(false);
  expect(validTypedHandoff({ ...fixture, total: 5 }, attempt, window)).toBe(false);
  expect(validTypedHandoff(fixture, attempt, { ...window, items: [{ ...window.items[0]!, items: null, items_unavailable_reason: "response_budget" }] })).toBe(false);
  expect(validTypedHandoff(fixture, attempt, { ...window, items: [] })).toBe(false);
});

it("keeps multiple attempts and interleaved ordinals strictly distinct", () => {
  const registry = typedHandoffRegistry({ threadId: "thread", attemptId: "attempt-2", turnId: "turn-2", revision: 9, total: 8,
    refs: [{ nodeId: "answer-a", ordinal: 2, text: "A" }, { nodeId: "answer-b", ordinal: 5, text: "B" }] });
  const attempt = registry.attempt();
  expect(attempt.response_nodes.map(node => [node.node_id, node.ordinal])).toEqual([["answer-a", 2], ["answer-b", 5]]);
  expect(registry.history({ node_id: "answer-a", ordinal: 5 })).toBeUndefined();
  expect(registry.history({ node_id: "answer-b", ordinal: 5 })?.items[0]?.selection.ordinal).toBe(5);
  expect(() => typedHandoffRegistry({ threadId: "thread", attemptId: "attempt-2", turnId: "turn-2", revision: 9, total: 8,
    refs: [{ nodeId: "answer-a", ordinal: 5, text: "A" }, { nodeId: "answer-b", ordinal: 5, text: "B" }] })).toThrow();
});

it('public response tuples use current selected kinds and selected replies preserve exact original bounds',()=>{
 const registry=typedHandoffRegistry({threadId:'t',attemptId:'a',turnId:'turn',revision:8,total:4,refs:[{nodeId:'a',ordinal:2,text:'A'},{nodeId:'b',ordinal:3,text:'B'}]});
 expect(registry.attempt().response_nodes).toEqual([{node_id:'a',ordinal:2,kind:'assistant_response'},{node_id:'b',ordinal:3,kind:'assistant_response'}]);
 const rows=[{node_id:'human',kind:'user',selection:{ordinal:0},items:[]},{node_id:'tool',kind:'tool_result',selection:{ordinal:1},items:[]},
  {node_id:'a',kind:'assistant_response',selection:{ordinal:2},items:[]},{node_id:'b',kind:'assistant_response',selection:{ordinal:3},items:[]}];
 expect(typedSelectedCoverageWindow('t',8,4,rows,{node_id:'a',before:0,after:199}).items.map(row=>row.node_id)).toEqual(['a','b']);
 expect(typedSelectedCoverageWindow('t',8,4,rows,{node_id:'a',before:2,after:1}).items.map(row=>row.node_id)).toEqual(['human','tool','a','b']);
 expect(()=>typedSelectedCoverageWindow('t',8,4,rows,{node_id:'a',before:200,after:0})).toThrow('bounds');
});
