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

import {admitNotificationDescriptor} from '../src/message-provenance';
const notifications=[
 {kind:'turn_started'}, {kind:'recovery_resumed'},
 ...['first_seen','updated','removed'].map(observation=>({kind:'instructions_observed',observation})),
 {kind:'thread_settings_changed',changed_fields:['cwd','connection','model','effort']},
 ...['exited','failed','stopped'].map(state=>({kind:'shell_ended',execution_id:'exact-exec',state})),
 {kind:'shell_ended',execution_id:'exact-exec',state:'exited',exit_code:-2147483648},
 {kind:'shell_ended',execution_id:'exact-exec',state:'exited',exit_code:2147483647},
];
it.each(notifications)('302 admits only public five-variant structure %j',value=>{
 expect(admitNotificationDescriptor(value)).toEqual(value);
});
it.each([
 null,{}, {kind:'future'}, {kind:'turn_started',body:'PRIVATE'},
 {kind:'instructions_observed',observation:'future'},
 {kind:'thread_settings_changed',changed_fields:[]},
 {kind:'thread_settings_changed',changed_fields:['cwd','cwd']},
 {kind:'thread_settings_changed',changed_fields:['secret_value']},
 {kind:'shell_ended',execution_id:' ',state:'exited'},
 {kind:'shell_ended',execution_id:'exec',state:'running'},
 ...[null,1.5,-2147483649,2147483648,'0'].map(exit_code=>({kind:'shell_ended',execution_id:'exec',state:'exited',exit_code})),
 {kind:'shell_ended',execution_id:'exec',state:'exited',command:'PRIVATE'},
])('302 quarantines only invalid optional notification %j',notification=>{
 const node={node_id:'node',kind:'event',text:'Independent body',provenance:{sender:{kind:'system'},message:{expect_reply:false},notification,created_at:'exact',future_independent:{kept:true}}};
 const result=sanitizeMessageRelation(node);
 expect(result.text).toBe(node.text);
 expect(result.provenance).toEqual({sender:{kind:'system'},message:{expect_reply:false},created_at:'exact',future_independent:{kept:true}});
 expect(node.provenance.notification).toBe(notification);
});
it('302 legacy absence stays absent and unknown without changing canonical identity',()=>{
 const node={node_id:'canonical',kind:'event',text:'old body',provenance:{sender:{kind:'system'}}};
 expect(sanitizeMessageRelation(node)).toBe(node);
});
it.each([255,256,257])('302 execution ID UTF8 boundary %i',length=>{
 const value={kind:'shell_ended',execution_id:'界'.repeat(85)+'x'.repeat(length-255),state:'exited'};
 expect(new TextEncoder().encode(value.execution_id).length).toBe(length);
 expect(admitNotificationDescriptor(value)).toEqual(length<=256?value:undefined);
});
it.each([2047,2048,2049])('302 descriptor UTF8 serialized boundary %i',length=>{
 // Parsed JSON may contain escaped equivalents: N1 measures its serialized value,
 // not original wire bytes; duplicate keys and pre-parse limits belong to N2.
 const prefix={kind:'shell_ended',execution_id:'exec',state:'exited'};
 const extra={...prefix,extra:'界'.repeat(700)};
 const raw=JSON.stringify(extra);
 const padded={...prefix,extra:'x'.repeat(length-(raw.length-extra.extra.length))};
 expect(new TextEncoder().encode(JSON.stringify(padded)).length).toBe(length);
 expect(admitNotificationDescriptor(padded)).toBeUndefined();
});
