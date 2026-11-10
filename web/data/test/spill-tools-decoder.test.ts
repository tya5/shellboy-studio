import { expect,it } from 'vitest';
import { Link } from '../src/link';
import { Operations } from '../src/operations';
import { FakeTransport } from './harness';
async function decode(fields:object){const t=new FakeTransport();const l=new Link(t);l.start();t.open();const p=new Operations(l,()=> 'test').historyWindow({thread_id:'t'});const value={thread_id:'t',revision:1,total:1,items:[{node_id:'n',kind:'spill',selection:{ordinal:0},...fields}]};t.ok(t.calls()[0]!.id,JSON.parse(JSON.stringify(value)));const r=await p;l.stop();return r;}
const known={status:'known',truncated:false,items:[{call_id:'call',execution_id:'exec',original_node_id:'original'}]};
it.each([{}, {spill_tools:null},{spill_tools:known},{spill_tools:{status:'unknown',truncated:true,items:[]}},{spill_tools:{...known,items:[{call_id:'call',execution_id:null}]} }])('preserves absent/null/existing public shapes %#',async f=>{const r=await decode(f);expect(r.ok).toBe(true);if(r.ok)expect(r.value.items[0]?.spill_tools).toEqual(f.spill_tools);});
it('preserves duplicate/conflicting explicit identities without inventing joins or rejecting valid wire',async()=>{const spill_tools={...known,items:[{call_id:'call',execution_id:'a'},{call_id:'call',execution_id:'b'},{call_id:'call',execution_id:'a'}]};const r=await decode({spill_tools});expect(r.ok).toBe(true);if(r.ok)expect(r.value.items[0]?.spill_tools).toEqual(spill_tools);});
it.each([42,{...known,status:2},{...known,truncated:'true'},{...known,items:[{call_id:2}]},{...known,items:[{call_id:'call',execution_id:4}]},{...known,items:Array(9).fill({call_id:'call'})},{...known,items:[{call_id:'é'.repeat(129)}]}])('rejects malformed bounded metadata %#',async spill_tools=>{expect((await decode({spill_tools})).ok).toBe(false);});
