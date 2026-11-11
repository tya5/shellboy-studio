import {expect,it} from 'vitest';
import {admitMessageProvenance,sanitizeMessageRelation} from '../src/message-provenance';
it.each([
 {expect_reply:false},{expect_reply:false,reply_to:'request'},
 ...['pending','ignored','cancelled'].map(reply_state=>({expect_reply:true,reply_state})),
 {expect_reply:true,reply_state:'replied',reply_node_id:'reply'},
])('admits exact relationship table row %j',value=>expect(admitMessageProvenance(value,'self')).toEqual(value));
it.each([null,{}, {expect_reply:0},{expect_reply:false,reply_to:null},{expect_reply:false,reply_state:'pending'},{expect_reply:true,reply_state:'replied'},{expect_reply:true,reply_state:'pending',reply_node_id:'reply'},{expect_reply:true,reply_state:'future'},{expect_reply:false,reply_to:'self'},{expect_reply:false,reply_to:'x'.repeat(257)},{expect_reply:false,extra:'x'.repeat(4096)}])('quarantines invalid relation without losing sender/body %j',message=>{
 const node={node_id:'self',kind:'user',text:'Body stays',provenance:{sender:{kind:'model',thread_id:'source'},message}};
 const result=sanitizeMessageRelation(node as never);
 expect(result.text).toBe('Body stays');expect(result.provenance?.sender).toEqual(node.provenance.sender);expect(result.provenance).not.toHaveProperty('message');
});
