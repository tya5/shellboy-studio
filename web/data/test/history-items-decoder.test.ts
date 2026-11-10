import { expect, it } from 'vitest';
import { Link } from '../src/link';
import { Operations } from '../src/operations';
import { FakeTransport } from './harness';
const text={kind:'text',item_identity:'item-a',text:'saved',text_complete:false};
const node=(items:unknown)=>({node_id:'node-a',kind:'assistant_response',selection:{ordinal:0},items});
const window=(items:unknown[])=>({thread_id:'thread-a',revision:'revision-a',total:items.length,items});
async function decode(value:unknown, opt=true){const t=new FakeTransport();const link=new Link(t);link.start();t.open();const ops=new Operations(link,()=> 'synthetic');const pending=ops.historyWindow({thread_id:'thread-a',items:opt});expect(t.calls()[0]?.args).toEqual({thread_id:'thread-a',items:opt});t.ok(t.calls()[0]!.id,JSON.parse(JSON.stringify(value)));const out=await pending;link.stop();return out;}
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
