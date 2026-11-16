import {expect,it} from 'vitest';
import {ConversationWindow,type WindowReadArgs} from '../src/window';
import {flush} from '../../data/test/harness';
import {rig as ownerRig,createBoundWindow} from './window-owner';
import {captureConversationInput,captureCurrentWork} from '../src/conversation-input';
import {ownedHistory} from '../../data/test/owned-history';

it('older tail and verification replies do not manufacture retry demand or change the accepted current cut',async()=>{
 let revision=8;const reads:WindowReadArgs[]=[];
 const owner=await ownerRig(0);owner.w.dispose();
 const w=createBoundWindow({read:async args=>{
  reads.push(args);return{ok:true,value:ownedHistory({thread_id:owner.handle.threadId,revision,total:1,items:[{node_id:'human',kind:'user',selection:{ordinal:0},
   provenance:{sender:{kind:'human'}},items:[{kind:'text',item_identity:'body',text:revision===8?'Current human':'Forbidden old human',text_complete:true}]}]})};
 }},owner.handle,{capture:snapshot=>captureConversationInput(snapshot,{scope:'history',threadId:owner.handle.threadId,records:owner.handle.handoff.value,work:captureCurrentWork(owner.handle.threadId,owner.handle.work.value.value),current:()=>true})});
 try{
  await flush();const before=w.acceptedView.peek();expect(reads).toHaveLength(1);
  const original=JSON.stringify(before.rows);revision=7;
  w.changed();await flush();
  expect(reads).toHaveLength(3);expect(reads.slice(1)).toMatchObject([{ordinal:0,before:0,after:199,expect_node_id:'human'},{ordinal:0,before:0,after:0,expect_node_id:'human'}]);
  expect(w.acceptedView.peek()).toBe(before);expect(w.acceptedView.isCurrent(before)).toBe(true);
  expect(before.revision).toBe(8);expect(JSON.stringify(before.rows)).toBe(original);
  expect(before.displayPlan?.entries[0]?.body).toMatchObject({kind:'typed-canonical',text:'Current human'});
  w.changed();await flush();expect(reads).toHaveLength(5);expect(w.acceptedView.peek()).toBe(before);
 }finally{w.dispose();owner.handle.close();owner.data.stop();}
});
