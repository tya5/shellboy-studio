import { expect, it } from 'vitest';
import { Link } from '../src/link';
import { Operations } from '../src/operations';
import { FakeTransport } from './harness';
const text={kind:'text',item_identity:'item-a',text:'saved',text_complete:false};
const node=(items:unknown)=>({node_id:'node-a',kind:'assistant_response',selection:{ordinal:0},items});
const window=(items:unknown[])=>({thread_id:'thread-a',revision:'revision-a',total:items.length,items});
async function decode(value:unknown, opt=true){const t=new FakeTransport();const link=new Link(t);link.start();t.open();const ops=new Operations(link,()=> 'synthetic', () => true);const pending=ops.historyWindow({thread_id:'thread-a',items:opt});expect(t.calls()[0]?.args).toEqual({thread_id:'thread-a',items:opt});t.ok(t.calls()[0]!.id,JSON.parse(JSON.stringify(value)));const out=await pending;link.stop();return out;}
it('accepts encoded opt-in whole arrays and authoritative incomplete/empty text boundaries',async()=>{
 const value=window([node([text,{...text,item_identity:'empty',text:'',text_complete:true},{kind:'tool_call',item_identity:'tool',execution_ids:['exec']},{kind:'reasoning_unavailable',item_identity:'reason'},{kind:'unavailable',item_identity:'lost',reason:'legacy'}])]);expect(await decode(value)).toEqual({ok:true,value});
});
it('legacy missing item projection stays missing without raw excerpt conversion',async()=>{
 const value=window([{node_id:'legacy',kind:'assistant_response',selection:{ordinal:0},excerpt:'{"not":"prose proof"}'}]);expect(await decode(value,false)).toEqual({ok:true,value});
});
it('keeps ordinary nodes and null response-budget suffix as whole deferred nodes',async()=>{
 const value=window([node([text]),{...node(null),node_id:'later',selection:{ordinal:1},items_unavailable_reason:'response_budget'}]);expect(await decode(value)).toEqual({ok:true,value});
});
it.each([
 [{...text,text_complete:'false'}], [{...text,text:9}], [{...text,item_identity:''}],
 [{kind:'tool_call',item_identity:'tool',execution_ids:[4]}],
 [{kind:'reasoning_unavailable',item_identity:'reason',text:'must not leak'}],
 [{kind:'invented',item_identity:'unknown'}],
 [{...text,text:'a'.repeat(16385)}],
 [{kind:'tool_result',item_identity:'tool',execution_ids:Array(9).fill('exec')}],
 [text,{...text}],
].map(items=>({items})))('rejects encoded malformed typed fields %#',async ({items})=>{expect((await decode(window([node(items)]))).ok).toBe(false);});
it('rejects null without explicit response budget',async()=>{expect((await decode(window([node(null)]))).ok).toBe(false);});
it('rejects item-bearing nodes after response budget suffix begins',async()=>{
 expect((await decode(window([{...node(null),items_unavailable_reason:'response_budget'},{...node([text]),node_id:'later',selection:{ordinal:1}}]))).ok).toBe(false);
});
it('rejects aggregate decoded UTF-8 item text above 4MiB',async()=>{
 const nodes=Array.from({length:17},(_,n)=>({...node(Array.from({length:16},(_,i)=>({...text,item_identity:String(i),text:'a'.repeat(16384)}))),node_id:String(n),selection:{ordinal:n}}));
 expect((await decode(window(nodes))).ok).toBe(false);
});

it.each(['',null,17,undefined])('rejects malformed deferred-node identity %j before retry publication',async node_id=>{
 expect((await decode(window([{...node(null),node_id,items_unavailable_reason:'response_budget'}]))).ok).toBe(false);
});
it('rejects negative safe ordinals in mixed legacy/projected windows',async()=>{
 expect((await decode(window([{node_id:'legacy',kind:'user',selection:{ordinal:-2}},{...node([text]),selection:{ordinal:-1}}]))).ok).toBe(false);
});

const descriptor={name:'lookup',name_state:'available',call_id:'call-exact',call_id_state:'available'};
const tool={kind:'tool_call',item_identity:'canonical-tool',execution_ids:[],descriptor,detail_availability:'unavailable'};
it('298 zero-execution descriptor preserves exact identity, name, call ID and unavailability',async()=>{
 const value=window([node([tool])]);expect(await decode(value)).toEqual({ok:true,value});
});
it('298 result does not infer name or output completeness from verified execution routing',async()=>{
 const item={...tool,kind:'tool_result',execution_ids:['actual'],descriptor:{call_id:'call-exact',call_id_state:'available',name_state:'not_applicable'},detail_availability:'execution_linked'};
 const value=window([node([item])]);expect(await decode(value)).toEqual({ok:true,value});
});
it.each([
 {...tool,descriptor:undefined},{...tool,detail_availability:undefined},{...tool,descriptor:null},
 {...tool,descriptor:{...descriptor,name:'bad name'}},{...tool,descriptor:{...descriptor,name:'界'}},
 {...tool,descriptor:{...descriptor,call_id:'界'.repeat(86)}},{...tool,descriptor:{...descriptor,name_state:'invalid'}},
 {...tool,descriptor:{...descriptor,name_state:'invented'}},{...tool,descriptor:{...descriptor,extra:'SECRET'}},
 {...tool,descriptor:{...descriptor,call_id_state:'not_applicable'}},{...tool,kind:'tool_result'},
 {...tool,detail_availability:'execution_linked'},{...tool,execution_ids:['actual']},
])('298 rejects partial, malformed, extra or inconsistent metadata %#',async item=>{expect((await decode(window([node([item])]))).ok).toBe(false);});
it('298 legacy omission stays unknown while unavailable metadata remains explicit',async()=>{
 const item={...tool,descriptor:{name_state:'missing',call_id_state:'field_budget'}};
 const legacy={kind:'tool_call',item_identity:'legacy',execution_ids:[]};
 const value=window([node([item,legacy])]);expect(await decode(value)).toEqual({ok:true,value});
});
it('298 exact UTF8 call IDs preserve distinct canonical items without merging',async()=>{
 const a={...tool,descriptor:{...descriptor,call_id:'界'.repeat(85)}};const b={...a,item_identity:'other'};
 const value=window([node([a,b])]);expect(await decode(value)).toEqual({ok:true,value});
});
it('298 descriptor strings charge shared 4MiB ledger exactly once',async()=>{
 const max={...tool,descriptor:{...descriptor,name:'n'.repeat(256),call_id:'c'.repeat(256)}};
 const make=(lastBytes:number)=>window(Array.from({length:128},(_,n)=>({...node([
 {...text,item_identity:'t1',text:'a'.repeat(16384)},
 {...text,item_identity:'t2',text:'a'.repeat(n===127?lastBytes:15872)},max]),node_id:String(n),selection:{ordinal:n}})));
 expect((await decode(make(15872))).ok).toBe(true);
 expect((await decode(make(15873))).ok).toBe(false);
});
