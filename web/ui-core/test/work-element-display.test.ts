import { expect, it } from "vitest";
import { normalizeTerminalPresenceFacts, projectSavedItems, projectLegacyHistoryItems, CANONICAL_CASES } from "../src/conversation-items";
import { workElementDisplay } from "../src/work-element-display";
import type { HistoryItem } from "../../data/src/protocol";
function display(nodes: HistoryItem[]) {
 const result = projectLegacyHistoryItems({ nodes, keyScope: ["owner", "thread", "life"] });
 return result.projection.items.filter(item => item.classification?.classification === "work").map(item => ({ item, value: workElementDisplay(item) }));
}
it("tool metadata comes only from original exact execution association, never another shell", () => {
 const [row] = display([{ node_id: "n", kind: "assistant_response", items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["yes"] }], executions: [
 { execution_id: "no", command_excerpt: "wrong", state: "running" }, { execution_id: "yes", command_excerpt: "printf safe", state: "exited", exit_code: 0 }] }]);
 expect(row!.value).toMatchObject({ contentLabel: { text: "printf safe" }, state: { source: "wire", value: "exited", exitCode: 0 }, detailPolicy: "existing-shell-output" });
 expect(JSON.stringify(row!.value)).not.toContain("wrong");
 expect(workElementDisplay({ ...row!.item, source: { ...row!.item.source } })).toBeUndefined();
});
it.each(["reasoning", "reasoning_unavailable"])("%s publishes no inferred reasoning body", kind => {
 const [row] = display([{ node_id: "r", kind }]);
 expect(row!.value).toMatchObject({ contentLabel: { text: "Reasoning content is not publicly available" }, detailPolicy: "unavailable" });
});
it.each(["event", "context", "model_stream_observation", "message", "notification"])("%s reports honest missing context, not a fabricated cause", kind => {
 const [row] = display([{ node_id: "e", kind, provenance: { created_at: "2026-01-01T00:00:00Z" } }]);
 expect(row!.value!.contentLabel.text).toContain("2026-01-01T00:00:00Z");
 expect(row!.value!.contentLabel.text).not.toContain(kind + ":"); expect(row!.value!.state).toBeNull();
});
it.each(["interruption_details", "interruption_context", "incomplete_response", "interrupted_wait"])("%s does not infer missing response detail", kind => {
 const [row] = display([{ node_id: "i", kind }]); expect(row!.value!.contentLabel.text).toBe("Response-state details were not provided");
 expect(row!.value!.detailPolicy).toBe("unavailable");
});
it.each(["response_budget", "source_budget", "unsupported"] as const)("wire %s machine reason remains distinct and exact", reason => {
 const [row] = display([{ node_id: "u", kind: "assistant_response", items: [{ kind: "unavailable", item_identity: "u", reason }] }]);
 expect(row!.value!.state).toEqual({ source: "wire", value: reason });
 expect(row!.value!.contentLabel.context).toContainEqual({ name: "reason", value: reason });
});
it("unknown kind is metadata, not a visible type prefix", () => {
 const [row] = display([{ node_id: "u", kind: "future_kind" }]);
 expect(row!.value!.contentLabel.text).toBe("Item details are not supported");
 expect(row!.value!.contentLabel.context).toContainEqual({ name: "kind", value: "future_kind" });
});
it("tool without associated shell does not fabricate executable detail", () => {
 const [row] = display([{ node_id: "t", kind: "tool_result" }]);
 expect(row!.value!.contentLabel.text).toBe("Execution content was not provided"); expect(row!.value!.detailPolicy).toBe("unavailable");
});
it("normalizer receipt identity survives projection; machine client reason is not wire or retry eligibility", () => {
 const receipt = { scope: "s", attemptId: "a", receipt: { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const }, phase: "settled" as const, reason: "read-error" as const, answerAvailability: "unknown" as const };
 const facts = normalizeTerminalPresenceFacts([receipt]);
 const item = projectSavedItems(facts).items[0]!;
 expect(workElementDisplay(item)).toMatchObject({ state: { source: "client", value: "read-error" }, detailPolicy: "none" });
 expect(JSON.stringify(workElementDisplay(item))).not.toMatch(/retry/i);
});
it("unissued arbitrary normalized object cannot acquire facts by matching its ID", () => {
 const source = { identityDomain: "node" as const, windowRevision: 1, itemIdentity: "x", kind: "reasoning_unavailable" as const, nodeId: "r", classificationCase: "reasoningMarker" as const };
 const item = projectSavedItems([source]).items[0]!;
 expect(workElementDisplay(item)).toBeUndefined();
});
it("normalizer source-scope mutation rejects facts rather than joining by node ID", () => {
 const item = projectLegacyHistoryItems({ nodes: [{ node_id: "n", kind: "event" }], keyScope: ["s"] }).projection.items[0]!;
 expect(workElementDisplay({ ...item, source: { ...item.source, keyScope: ["foreign"] } })).toBeUndefined();
});
it("live typed public records retain their exact state and no guessed body", async () => {
 const { normalizeLiveWorkFacts } = await import("../src/conversation-items");
 const facts = normalizeLiveWorkFacts({ scope: "t", items: [{ kind: "notification", id: "n", thread_id: "t", state: "pending" }] });
 const item = projectSavedItems(facts).items[0]!;
 expect(workElementDisplay(item)).toMatchObject({ contentLabel: { text: "Item details are not supported" }, state: { source: "wire", value: "pending" } });
});
it("all issued Work CASE paths yield nonempty content and one literal icon without copying bodies", () => {
 const nodes: HistoryItem[] = [{ node_id: "n", kind: "assistant_response", items: [
 { kind: "tool_result", item_identity: "result", execution_ids: [] }, { kind: "reasoning_unavailable", item_identity: "r" },
 { kind: "unavailable", item_identity: "u", reason: "legacy" }] }];
 for (const row of display(nodes)) { expect(row.value!.contentLabel.text.trim()).not.toBe(""); expect(row.value!.typeIcon).toBe(row.item.classification?.icon); }
});
it("changed receipt association cannot inherit the original display facts", () => {
 const presence = { scope: "s", attemptId: "a", receipt: { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const }, phase: "pending" as const, reason: "canonical-pending" as const, answerAvailability: "unknown" as const };
 const item = projectSavedItems(normalizeTerminalPresenceFacts([presence])).items[0]!;
 expect(workElementDisplay({ ...item, source: { ...item.source, keyScope: ["foreign"] } })).toBeUndefined();
});
it("exact execution selection preserves each command description and state without aggregate duplication", async () => {
 const { workExecutionDisplay } = await import("../src/work-element-display");
 const [row] = display([{ node_id: "n", kind: "assistant_response", items: [{ kind: "tool_call", item_identity: "c", execution_ids: ["a", "b"] }], executions: [
 { execution_id: "a", command_excerpt: "first", description: "safe first", state: "exited", exit_code: 0 },
 { execution_id: "b", command_excerpt: "second", description: "safe second", state: "running" }] }]);
 expect(workExecutionDisplay(row!.item, "a")).toMatchObject({ contentLabel: { text: "safe first" }, state: { value: "exited", exitCode: 0 } });
 expect(workExecutionDisplay(row!.item, "b")).toMatchObject({ contentLabel: { text: "safe second" }, state: { value: "running" } });
 expect(workExecutionDisplay(row!.item, "foreign")).toBeUndefined();
});
it("module scoping accepts only issued live/receipt and never arbitrary copies or unscoped saved facts", async () => {
 const { scopeIssuedWorkFacts, normalizeLiveWorkFacts } = await import("../src/conversation-items");
 const live = normalizeLiveWorkFacts({ scope: "t", items: [{ kind: "notification", id: "n", thread_id: "t", state: "pending" }] });
 const scope = ["owner", "t"], scoped = scopeIssuedWorkFacts(live, scope)!;
 expect(Object.isFrozen(scoped)).toBe(true); expect(Object.isFrozen(scoped[0]!.keyScope)).toBe(true); scope[0] = "changed";
 expect(scoped[0]!.keyScope).toEqual(["owner", "t"]);
 expect(scopeIssuedWorkFacts(scoped, ["owner", "t"])![0]).toBe(scoped[0]);
 expect(scopeIssuedWorkFacts(scoped, ["foreign"])).toBeUndefined();
 expect(scopeIssuedWorkFacts(live, [])).toBeUndefined(); expect(scopeIssuedWorkFacts(live, [""])).toBeUndefined();
 expect(scopeIssuedWorkFacts([{ ...live[0]! }], ["s"])).toBeUndefined();
 const saved = projectLegacyHistoryItems({ nodes: [{ node_id: "x", kind: "event" }] }).projection.items[0]!.source;
 expect(scopeIssuedWorkFacts([saved], ["s"])).toBeUndefined();
 expect(scopeIssuedWorkFacts([...live, { ...live[0]! }], ["s"])).toBeUndefined();
 expect(workElementDisplay(projectSavedItems(scoped).items[0]!)).toBeDefined();
});
it("scoped receipt keeps the exact original presence and rejects altered association", async () => {
 const { scopeIssuedWorkFacts } = await import("../src/conversation-items");
 const p = { scope: "opaque", attemptId: "a", receipt: { scope: "opaque", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const }, phase: "pending" as const, reason: "canonical-pending" as const, answerAvailability: "unknown" as const };
 const issued = normalizeTerminalPresenceFacts([p]); const scoped = scopeIssuedWorkFacts(issued, ["ui", "scope"])!;
 const item = projectSavedItems(scoped).items[0]!;
 expect(workElementDisplay(item)).toMatchObject({ state: { source: "client", value: "canonical-pending" } });
 expect("domain" in item.source && item.source.domain === "receipt" && item.source.terminalPresence).toBe(p);
 const source = issued[0]!;
 if (!("domain" in source) || source.domain !== "receipt") throw new Error("Expected issued receipt");
 expect(scopeIssuedWorkFacts([{ ...source, attemptId: "other" }], ["ui"])).toBeUndefined();
});
it("spill unavailable issuer emits display facts without hydrating original content", () => {
 const [row] = display([{ node_id: "s", kind: "spill", spill_tools: { status: "unknown", items: [], truncated: false } }]);
 expect(row!.value).toMatchObject({ contentLabel: { text: "Display content is unavailable" }, detailPolicy: "unavailable" });
});
it("spill exact public execution retains details, while unrelated executions stay unassociated", async () => {
 const { workExecutionDisplay } = await import("../src/work-element-display");
 const [row] = display([{ node_id: "spill", kind: "spill", spill_tools: { status: "known", truncated: false, items: [{ call_id: "call", execution_id: "yes" }] }, executions: [
 { execution_id: "yes", command_excerpt: "printf retained", description: "retained description", state: "exited", exit_code: 0 },
 { execution_id: "no", command_excerpt: "unrelated", state: "running" }] }]);
 expect(workExecutionDisplay(row!.item, "yes")).toMatchObject({ contentLabel: { text: "retained description" }, state: { value: "exited", exitCode: 0 }, detailPolicy: "existing-shell-output" });
 expect(workExecutionDisplay(row!.item, "no")).toBeUndefined();
});
for (const spill of [false, true]) for (const variant of ['description', 'command', 'none'] as const)
it(`tool label selects one original description or command spill=${spill} variant=${variant}`, async () => {
 const { workExecutionDisplay } = await import('../src/work-element-display');
 const description = variant === 'description' ? '  Original explanation  ' : ' \t ';
 const command = variant === 'none' ? ' \n ' : '  printf original  ';
 const node: HistoryItem = { node_id: 'n', kind: spill ? 'spill' : 'assistant_response',
 ...(spill ? { spill_tools: { status: 'known' as const, truncated: false, items: [{ call_id: 'c', execution_id: 'e' }] } } : { items: [{ kind: 'tool_call' as const, item_identity: 'c', execution_ids: ['e'] }] }),
 executions: [{ execution_id: 'e', description, command_excerpt: command, state: 'exited', exit_code: 0 }] };
 const [row] = display([node]); const expected = variant === 'description' ? description : variant === 'command' ? command : 'Execution content was not provided';
 for (const bundle of [row!.value!, workExecutionDisplay(row!.item, 'e')!]) {
  expect(bundle.contentLabel.text).toBe(expected);
  expect(bundle.contentLabel.context.some(c => c.name === 'description' || c.name === 'command_excerpt')).toBe(false);
  expect(bundle.state).toEqual({ source: 'wire', value: 'exited', executionStatus: 'completed', exitCode: 0 });
 }
});

it.each([['running',undefined,'running'],['exited',0,'completed'],['exited',7,'failed'],['stopped',null,'stopped'],['future',null,undefined]] as const)('exact execution %s exit %s uses the existing status mapping only',async(state,exit_code,status)=>{
 const {workExecutionDisplay}=await import('../src/work-element-display');
 const [row]=display([{node_id:'n',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'c',execution_ids:['e']}],executions:[{execution_id:'e',state,...(exit_code!==undefined?{exit_code}:{})}]}]);
 expect(workExecutionDisplay(row!.item,'e')!.state?.executionStatus).toBe(status);
});
it('wire reasons and client terminal states never acquire an execution status',()=>{
 const [row]=display([{node_id:'u',kind:'assistant_response',items:[{kind:'unavailable',item_identity:'u',reason:'unsupported'}]}]);
 expect(row!.value!.state?.executionStatus).toBeUndefined();
});
it('validated zero-execution descriptor survives accepted snapshot without fake output availability',async()=>{
 const {AcceptedView}=await import('../src/accepted-view');
 const descriptor={call_id:'exact-call',call_id_state:'available' as const,name:'safe_tool',name_state:'available' as const};
 const input:HistoryItem[]=[{node_id:'n',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'c',execution_ids:[],descriptor,detail_availability:'unavailable'}]}];
 const owner=new AcceptedView(input);const staged=owner.stage(input);owner.commit(staged);
 const item=owner.peek()[0]!.items![0]!;expect(item.kind==='tool_call'&&item.descriptor).toEqual(descriptor);
 const [row]=display(owner.peek());expect(row!.value).toMatchObject({contentLabel:{text:'safe_tool',context:expect.arrayContaining([{name:'call_id',value:'exact-call'}])},state:null,detailPolicy:'unavailable'});
 expect(Object.isFrozen(row!.value!.contentLabel.context)).toBe(true);
});
it.each(['description','command','missing'] as const)('validated name fallback preserves actual shell content priority %s',variant=>{
 const [row]=display([{node_id:'n',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'c',execution_ids:['e'],descriptor:{name:'tool_name',name_state:'available',call_id_state:'missing'},detail_availability:'execution_linked'}],executions:[{execution_id:'e',description:variant==='description'?'  explanation  ':' ',command_excerpt:variant==='command'?'  command  ':' '}]}]);
 expect(row!.value!.contentLabel.text).toBe(variant==='description'?'  explanation  ':variant==='command'?'  command  ':'tool_name');
 expect(row!.value!.state).toBeNull();
});
it('execution_linked is routing only and old-owner missing metadata stays unknown',()=>{
 const [linked]=display([{node_id:'n',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'c',execution_ids:['unloaded'],descriptor:{name:'safe',name_state:'available',call_id_state:'missing'},detail_availability:'execution_linked'}]}]);
 expect(linked!.value).toMatchObject({contentLabel:{text:'safe'},state:null,detailPolicy:'unavailable'});
 const [old]=display([{node_id:'o',kind:'assistant_response',items:[{kind:'tool_result',item_identity:'r',execution_ids:[]}]}]);
 expect(old!.value!.contentLabel.context.some(c=>c.name==='name_state'||c.name==='detail_availability')).toBe(false);
});
it('result descriptor never acquires a request name through call ID',()=>{
 const [row]=display([{node_id:'n',kind:'assistant_response',items:[{kind:'tool_result',item_identity:'r',execution_ids:[],descriptor:{call_id:'same',call_id_state:'available',name_state:'not_applicable'},detail_availability:'unavailable'}]}]);
 expect(row!.value!.contentLabel.text).toBe('Execution content was not provided');expect(row!.value!.detailPolicy).toBe('unavailable');
});
it('strict public operation descriptor reaches same accepted snapshot and issued display without a body lookup',async()=>{
 const {Link}=await import('../../data/src/link');const {Operations}=await import('../../data/src/operations');const {FakeTransport}=await import('../../data/test/harness');const {AcceptedView}=await import('../src/accepted-view');
 const t=new FakeTransport(),link=new Link(t);link.start();t.open();
 try{const ops=new Operations(link,()=> 'synthetic', () => true);const pending=ops.historyWindow({thread_id:'t',items:true});
 const descriptor={name:'actual_name',name_state:'available',call_id:'exact',call_id_state:'available'};
 t.ok(t.calls()[0]!.id,{thread_id:'t',revision:'r',total:1,items:[{node_id:'n',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'tool_call',item_identity:'c',execution_ids:[],descriptor,detail_availability:'unavailable'}]}]});
 const result=await pending;if(!result.ok)throw new Error('Strict decoder rejected fixture');
 const view=new AcceptedView(result.value.items);const [row]=display(view.peek());
 expect(row!.value).toMatchObject({contentLabel:{text:'actual_name'},state:null,detailPolicy:'unavailable'});
 expect(t.calls()).toHaveLength(1);
 }finally{link.stop();}
});
it('compressed tool without shell content still prefers its validated actual name',()=>{
 const rows=display([
 {node_id:'n',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'c',execution_ids:['e'],descriptor:{call_id:'call',call_id_state:'available',name:'actual_name',name_state:'available'},detail_availability:'unavailable'}]},
 {node_id:'s',kind:'spill',spill_tools:{status:'known',truncated:false,items:[{call_id:'call',execution_id:'e'}]}}
 ]);
 const row=rows.find(row=>row.item.source.kind==='tool'&&row.item.source.compressed)!;
 expect(row).toBeDefined();expect(row.value!.contentLabel.text).toBe('actual_name');expect(row.value!.detailPolicy).toBe('unavailable');
});
it('issued notification descriptors format typed meanings without exposing command, values or raw body',()=>{
 const notifications: import('../../data/src/protocol').NotificationDescriptor[] = [
 {kind:'turn_started'}, {kind:'recovery_resumed'},
 {kind:'instructions_observed',observation:'first_seen'},
 {kind:'instructions_observed',observation:'updated'},
 {kind:'instructions_observed',observation:'removed'},
 {kind:'thread_settings_changed',changed_fields:['cwd','model']},
 {kind:'shell_ended',execution_id:'exact-exec',state:'exited',exit_code:0}];
 const labels=['Turn started','Recovery resumed','Instructions observed','Instructions updated','Instructions removed','Thread settings changed','Shell execution ended'];
 for(const [index,notification] of notifications.entries()){
 const [row]=display([{node_id:`notice-${index}`,kind:'notification',excerpt:'PRIVATE BODY',provenance:{notification}}]);
 expect(row!.value!.contentLabel.text).toBe(labels[index]);
 expect(JSON.stringify(row!.value)).not.toContain('PRIVATE BODY');
 expect(workElementDisplay({...row!.item,source:{...row!.item.source}})).toBeUndefined();
 }
});
it('issued notification changed fields are frozen independently of the admitted input',()=>{
 const changed_fields: ('cwd'|'model')[]=['cwd'];
 const [row]=display([{node_id:'notice',kind:'notification',provenance:{notification:{kind:'thread_settings_changed',changed_fields},sender:{kind:'user'}}}]);
 changed_fields.push('model');
 expect(workElementDisplay(row!.item)!.contentLabel.context.filter(c=>c.name==='changed_field')).toEqual([{name:'changed_field',value:'cwd'}]);
});
it('legacy absent or quarantined optional notification leaves the honest unknown label',()=>{
 const [row]=display([{node_id:'legacy',kind:'notification',provenance:{sender:{kind:'user'}}}]);
 expect(row!.value!.contentLabel.text).toBe('A content summary was not provided');
});
