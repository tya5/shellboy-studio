import { expect, it } from 'vitest';
import { assistantOwnership } from '../src/assistant-ownership';
import type { DisplayAssociation } from '../../data/src/handoff';
import type { HistoryItem } from '../../data/src/protocol';
const association: DisplayAssociation = { scope: 'owner/thread/lifetime', attemptId: 'attempt', turnId: 'turn', refs: [{nodeId:'answer',ordinal:0,kind:'message'}] };
const answer = (): HistoryItem => ({node_id:'answer',kind:'assistant_response',selection:{ordinal:9},items:[{kind:'text',item_identity:'exact-text',text:'Same body',text_complete:true},{kind:'tool_call',item_identity:'independent-tool',execution_ids:['exec']}]});
it('owns exact ordinary item keys, preserving Work siblings and independent equal text identities',()=>{
 const other={...answer(),node_id:'other'};
 const decision=assistantOwnership(association,'original',[answer(),other],7)!;
 expect(decision).toMatchObject({scope:association.scope,attemptId:'attempt',turnId:'turn',mode:'canonical',recordKey:'original'});
 expect(decision.itemKeys).toHaveLength(1);
 expect(decision.itemKeys[0]).toContain('answer');expect(decision.itemKeys[0]).toContain('exact-text');
 expect(decision.itemKeys[0]).not.toContain('independent-tool');expect(decision.itemKeys[0]).not.toContain('other');
});
it.each(['partial','empty'] as const)('retains preview and reserves only exact ordinary membership for %s',mode=>{
 const node=answer();node.items=[{kind:'text',item_identity:'exact-text',text:mode==='empty'?'':'prefix',text_complete:mode!=='partial'},node.items![1]!];
 expect(assistantOwnership(association,'original',[node],7)).toMatchObject({mode:'preview',itemKeys:[expect.any(String)]});
});
it.each(['missing','unavailable','deferred','duplicate-item','duplicate-node','wrong-kind','tool-only','reasoning-only'] as const)('cannot fabricate body ownership from %s',mode=>{
 const node=answer();let nodes=[node];
 if(mode==='missing')nodes=[];
 if(mode==='unavailable')node.items=[{kind:'unavailable',item_identity:'unknown',reason:'legacy'}];
 if(mode==='deferred')node.items=null;
 if(mode==='duplicate-item')node.items=[node.items![0]!,node.items![0]!];
 if(mode==='duplicate-node')nodes.push(node);
 if(mode==='wrong-kind')node.kind='user';
 if(mode==='tool-only')node.items=[node.items![1]!];
 if(mode==='reasoning-only')node.items=[{kind:'reasoning_unavailable',item_identity:'reason'}];
 expect(assistantOwnership(association,'original',nodes,7)).toBeUndefined();
});
it('denies whole-bundle transfer with one missing node; never retires at first body',()=>{
 const multi={...association,refs:[...association.refs,{nodeId:'second',ordinal:1,kind:'message'}]};
 expect(assistantOwnership(multi,'original',[answer()],7)).toBeUndefined();
});
