import {selectedReadyRefs,syntheticPresentation,CANONICAL_ATTEMPT_ID} from '../../data/test/work-fixture';
import { expect, it } from 'vitest';
import { assistantOwnership } from '../src/assistant-ownership';
import type { DisplayAssociation, PresentationContainerId } from '../../data/src/handoff';
import type { AttemptId, HistoryItem } from '../../data/src/protocol';

const answer = (): HistoryItem => ({node_id:'answer',kind:'assistant_response',provenance:{attempt_id:CANONICAL_ATTEMPT_ID},selection:{ordinal:9},items:[{kind:'text',item_identity:'exact-text',text:'Same body',text_complete:true},{kind:'tool_call',item_identity:'independent-tool',execution_ids:['exec']}]});
const association:DisplayAssociation={scope:'owner/thread/lifetime',attemptId:CANONICAL_ATTEMPT_ID,turnId:'turn',presentationContainer:syntheticPresentation(CANONICAL_ATTEMPT_ID),refs:selectedReadyRefs(['answer'],[answer()])};
it('owns exact ordinary item keys, preserving Work siblings and independent equal text identities',()=>{
 const other={...answer(),node_id:'other',selection:{ordinal:10}};
 const decision=assistantOwnership(association,'original',[answer(),other],7)!;
 expect(decision).toMatchObject({scope:association.scope,attemptId:CANONICAL_ATTEMPT_ID,turnId:'turn',mode:'canonical',recordKey:'original'});
 expect(decision.itemKeys).toHaveLength(1);
 expect(decision.itemKeys[0]).toContain('answer');expect(decision.itemKeys[0]).toContain('exact-text');
 expect(decision.itemKeys[0]).not.toContain('independent-tool');expect(decision.itemKeys[0]).not.toContain('other');
});
it('keeps the owner-minted host from preview through canonical admission',()=>{
 const preview=assistantOwnership(association,'original',[answer()],7)!;
 const canonical=assistantOwnership(association,'original',[answer()],7)!;
 expect(preview.mode).toBe('canonical');
 expect(canonical.containerKey).toBe(preview.containerKey);
 expect(canonical.containerKey).not.toMatch(/^answer:/);
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
 const multi={...association,refs:[...association.refs,{nodeId:'second',ordinal:10,kind:'assistant_response'}]};
 expect(assistantOwnership(multi,'original',[answer()],7)).toBeUndefined();
});

it.each(['ordinal','kind'] as const)('cannot borrow body ownership from a wrong selected %s',mode=>{
 const mismatched:DisplayAssociation={...association,refs:association.refs.map(ref=>mode==='ordinal'?{...ref,ordinal:8}:{...ref,kind:'user'})};
 const node=answer();expect(assistantOwnership(mismatched,'original',[node],7)).toBeUndefined();
 expect(node.items?.[0]).toMatchObject({text:'Same body',text_complete:true});
});

it.each(['partial','empty'] as const)('a %s companion cannot suppress a separately complete saved member or retire the original',mode=>{
 const first=answer(),second:HistoryItem={node_id:'second',kind:'assistant_response',selection:{ordinal:10},items:[{kind:'text',item_identity:'companion',text:mode==='partial'?'Prefix':'',text_complete:mode==='empty'}]};
 const refs=[...association.refs,{nodeId:'second',ordinal:10,kind:'assistant_response'}];
 const decision=assistantOwnership({...association,refs},'original',[first,second],7)!;
 expect(decision.mode).toBe('preview');expect(decision.itemKeys).toEqual([JSON.stringify(['second','companion'])]);
 expect(decision.refs).toEqual(refs);expect(decision.containerKey).toBe(association.presentationContainer);
});


it('admits canonical saved ownership only with matching provenance on every selected node',()=>{
 const node={...answer(),provenance:{attempt_id:CANONICAL_ATTEMPT_ID}};
 expect(assistantOwnership(association,'original',[node],7)).toMatchObject({mode:'canonical',attemptId:association.attemptId});
});
it.each(['missing','mismatch'] as const)('keeps %s saved association unknown without changing preview semantics',mode=>{
 const node=mode==='missing'?(({provenance: _ignored, ...rest})=>rest)(answer()):{...answer(),provenance:{attempt_id:'other-attempt' as AttemptId}};
 expect(assistantOwnership(association,'original',[node],7)).toBeUndefined();
 const partial={...answer()};partial.items=[{kind:'text',item_identity:'exact-text',text:'prefix',text_complete:false},partial.items![1]!];
 expect(assistantOwnership(association,'original',[partial],7)).toMatchObject({mode:'preview'});
});
