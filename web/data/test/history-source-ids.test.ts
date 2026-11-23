import { expect, it } from 'vitest';
import { Link } from '../src/link';
import { Operations } from '../src/operations';
import { FakeTransport } from './harness';
import { decodeHistoryWindow } from '../src/history-decoder';
async function decode(extra:object){const t=new FakeTransport();const link=new Link(t);link.start();t.open();const p=new Operations(link,()=> 'synthetic').historyGet({node_id:'summary'});t.ok(t.calls()[0]!.id,JSON.parse(JSON.stringify({node_id:'summary',kind:'summary',text:'ordinary body',...extra})));const result=await p;link.stop();return result;}
it.each([{},{source_node_ids:[]},{source_node_ids:['source-a','source-b']}])('retains legacy, empty, or explicit public relation %#',async fields=>{const r=await decode(fields);expect(r.ok).toBe(true);if(r.ok){expect(r.value.text).toBe('ordinary body');expect(r.value.source_node_ids).toEqual(fields.source_node_ids);}});
it.each([{source_node_ids:null},{source_node_ids:'source'},{source_node_ids:[1]},{source_node_ids:['']},{source_node_ids:['a','a']},{source_node_ids:Array.from({length:4097},(_,i)=>String(i))}])('rejects malformed bounded relation %#',async fields=>{expect((await decode(fields)).ok).toBe(false);});
it('accepts exactly 4096 explicit IDs without inventing a revision or transitive membership',async()=>{const ids=Array.from({length:4096},(_,i)=>String(i));const r=await decode({source_node_ids:ids});expect(r.ok).toBe(true);if(r.ok){expect(r.value.source_node_ids).toEqual(ids);expect(r.value.revision).toBeUndefined();}});
// Core942 compaction.rs1477-1487 inserts fresh node/relation; history.rs832-835
// exposes direct sources. This does NOT assert immutable text: parts cache at757-764.

const attemptId='00000000-0000-4000-8000-000000000001';
it('retains a strict optional attempt association and unknown provenance extras',async()=>{
 const r=await decode({provenance:{attempt_id:attemptId, future_marker:'kept'}});
 expect(r.ok).toBe(true);if(r.ok)expect(r.value.provenance).toMatchObject({attempt_id:attemptId,future_marker:'kept'});
});
it.each(['attempt','00000000-0000-4000-8000-00000000000', '00000000-0000-4000-8000-00000000000A',null,123])('rejects malformed history.get attempt association %#',async attempt_id=>{
 expect((await decode({provenance:{attempt_id}})).ok).toBe(false);
});

const windowRow=(provenance?:unknown)=>({thread_id:'t',revision:1,total:1,items:[{node_id:'n',kind:'assistant_response',selection:{ordinal:0},provenance,items:null,items_unavailable_reason:'response_budget'}]});
it.each(['00000000-0000-0000-0000-000000000000','00000000-0000-4000-0000-000000000001'])('history.window retains Core-canonical UUID variant/version form %s',attempt_id=>{const r=decodeHistoryWindow(windowRow({attempt_id}));expect(r.ok).toBe(true);if(r.ok)expect(r.value.items[0]!.provenance?.attempt_id).toBe(attempt_id);});
it('history.window preserves absent attempt association as unknown',()=>{expect(decodeHistoryWindow(windowRow()).ok).toBe(true);});
it('history.window rejects malformed attempt association',()=>{expect(decodeHistoryWindow(windowRow({attempt_id:'not-a-uuid'})).ok).toBe(false);});

it('history.window admits Core output-limit provenance while rejecting malformed evidence',()=>{
 const fact={stop:true,sent_max_tokens:4096,source:'connection',connection:'synthetic'};
 const protocol15Provenance={kind:'assistant_response',created_at:'2026-11-23T00:00:00Z',source_revision:1,attempt_id:attemptId,output_limit:fact};
 for(const source of ['thread_override','connection','default','extra_body',null]) for(const sent_max_tokens of [4096,null])
  expect(decodeHistoryWindow(windowRow({output_limit:{...fact,source,sent_max_tokens}})).ok).toBe(true);
 const valid=decodeHistoryWindow(windowRow(protocol15Provenance));
 expect(valid.ok).toBe(true);if(valid.ok)expect(valid.value.items[0]!.provenance?.output_limit).toEqual(fact);
 for(const output_limit of [{...fact,stop:false},{...fact,sent_max_tokens:-1},{...fact,sent_max_tokens:1.5},{...fact,source:'provider'},{...fact,connection:undefined}])
  expect(decodeHistoryWindow(windowRow({output_limit})).ok).toBe(false);
});
