import {expect,it} from 'vitest';
import {senderHeaderDisplay} from '../src/sender-display';
it('uses observed nonblank title but keeps exact source route and disambiguates unresolved identity',()=>{
 const first=senderHeaderDisplay('abcdefgh-one',{state:'ready',title:'Same title'},'Model');
 const second=senderHeaderDisplay('abcdefgh-two',{state:'ready',title:'Same title'},'Model');
 expect(first.label).toBe(second.label);expect(first.href).not.toBe(second.href);
 for(const title of [undefined,{state:'unresolved' as const},{state:'ready' as const,title:'   '}])expect(senderHeaderDisplay('abcdefgh-one',title,'Model')).toMatchObject({label:'Model',fallbackId:'abcdefgh',href:first.href});
 expect(senderHeaderDisplay('exact-id',{state:'ready',title:'<script> & title'},'Model').label).toBe('<script> & title');
});
import {messageRelationship} from '../src/sender-display';
const relationCases: [unknown,unknown][] = [
 [undefined,{kind:'unavailable'}],
 [{expect_reply:false},{kind:'ordinary'}],
 [{expect_reply:false,reply_to:'request'},{kind:'reply',requestId:'request'}],
 ...['pending','ignored','cancelled'].map(state=>[{expect_reply:true,reply_state:state},{kind:'request',state,replyId:undefined}] as [unknown,unknown]),
 [{expect_reply:true,reply_state:'replied',reply_node_id:'reply'},{kind:'request',state:'replied',replyId:'reply'}],
 [{expect_reply:true,reply_state:'replied',reply_node_id:null},{kind:'unavailable'}],
];
it.each(relationCases)('maps an admitted independent relation without sender reclassification %j',(input,expected)=>expect(messageRelationship(input,'self')).toEqual(expected));
