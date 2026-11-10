import { expect, it } from 'vitest';
import { Link } from '../src/link';
import { Operations } from '../src/operations';
import { FakeTransport } from './harness';
async function decode(extra:object){const t=new FakeTransport();const link=new Link(t);link.start();t.open();const p=new Operations(link,()=> 'synthetic').historyGet({node_id:'summary'});t.ok(t.calls()[0]!.id,JSON.parse(JSON.stringify({node_id:'summary',kind:'summary',text:'ordinary body',...extra})));const result=await p;link.stop();return result;}
it.each([{},{source_node_ids:[]},{source_node_ids:['source-a','source-b']}])('retains legacy, empty, or explicit public relation %#',async fields=>{const r=await decode(fields);expect(r.ok).toBe(true);if(r.ok){expect(r.value.text).toBe('ordinary body');expect(r.value.source_node_ids).toEqual(fields.source_node_ids);}});
it.each([{source_node_ids:null},{source_node_ids:'source'},{source_node_ids:[1]},{source_node_ids:['']},{source_node_ids:['a','a']},{source_node_ids:Array.from({length:4097},(_,i)=>String(i))}])('rejects malformed bounded relation %#',async fields=>{expect((await decode(fields)).ok).toBe(false);});
it('accepts exactly 4096 explicit IDs without inventing a revision or transitive membership',async()=>{const ids=Array.from({length:4096},(_,i)=>String(i));const r=await decode({source_node_ids:ids});expect(r.ok).toBe(true);if(r.ok){expect(r.value.source_node_ids).toEqual(ids);expect(r.value.revision).toBeUndefined();}});
// Core942 compaction.rs1477-1487 inserts fresh node/relation; history.rs832-835
// exposes direct sources. This does NOT assert immutable text: parts cache at757-764.
