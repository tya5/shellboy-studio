import { describe, expect, it } from 'vitest';
import { fixtureModel, settle } from './fixture';
import { projectConversation } from '../src/conversation';
const senderNode=(sender:unknown)=>({node_id:'sender-node',kind:'user',excerpt:'synthetic message',provenance:{sender:sender as {kind:string}}});
describe('product model sender provenance',()=>{
  it('projects model identity without treating the current Thread, labels or absent facts as human',()=>{
    for(const sender of [{kind:'model',thread_id:'sender-a',label:'claim'}, {kind:'model'}, null,[],{kind:'future',label:'You'}]){
      const row=projectConversation([senderNode(sender)])[0]!;expect(row.type==='message'&&row.speaker.kind).not.toBe('you');
    }
    expect(projectConversation([senderNode({kind:'model',thread_id:'opaque-not-a-uuid',label:'claim'})])[0]).toMatchObject({speaker:{kind:'model',threadId:'opaque-not-a-uuid',label:'claim'}});
  });
  it('resolves visible sender IDs and has no repeated lookup on history hint churn',async()=>{
    const r=await fixtureModel({configure(db){db.history.lead=[senderNode({kind:'model',thread_id:'sender-a'})];db.threads['sender-a']={...db.threads.lead!,thread_id:'sender-a',title:'Current sender title'};}});
    await settle(r.t,r.db);expect(r.model.senderTitles.values.value.get('sender-a')).toEqual({state:'ready',title:'Current sender title'});
    const before=r.t.calls('thread.get').filter(c=>(c.args as {thread_id:string}).thread_id==='sender-a').length;
    for(let n=0;n<20;n++){r.t.push({t:'changed',thread_ids:['lead'],list:false});await settle(r.t,r.db);}
    expect(r.t.calls('thread.get').filter(c=>(c.args as {thread_id:string}).thread_id==='sender-a')).toHaveLength(before);
    r.model.applyRoute({view:'settings'});await settle(r.t,r.db);expect(r.model.senderTitles.values.value.size).toBe(0);r.model.dispose();
  });
  it('uses selected-page/owner/route lifetime rather than arbitrary rendering as a refill',async()=>{
    const r=await fixtureModel({configure(db){db.history.lead=[senderNode({kind:'model',thread_id:'not-listed'})];}});
    await settle(r.t,r.db);const first=r.model.senderTitles.attemptCount;expect(first).toBe(1);
    r.model.now.value += 1;await settle(r.t,r.db);expect(r.model.senderTitles.attemptCount).toBe(first);
    r.model.senderPageSelected();await settle(r.t,r.db);expect(r.model.senderTitles.attemptCount).toBe(1);
    r.model.dispose();expect(r.model.senderTitles.values.value.size).toBe(0);
  });
});

it('does not resolve sender IDs from old-owner history while new-owner reads are pending',async()=>{
  const r=await fixtureModel({configure(db){db.history.lead=[senderNode({kind:'model',thread_id:'old-sender'})];}});
  await settle(r.t,r.db);
  const before=r.t.calls('thread.get').filter(c=>(c.args as {thread_id:string}).thread_id==='old-sender').length;
  r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{protocol_version:5,instance_id:'new-owner',capabilities:[]}}});
  for(let n=0;n<12;n++)await Promise.resolve();
  expect(r.model.senderTitles.values.value.size).toBe(0);
  expect(r.t.calls('thread.get').filter(c=>(c.args as {thread_id:string}).thread_id==='old-sender')).toHaveLength(before);
  r.model.dispose();
});

it('an old explicit-page completion cannot refill a newly selected route',async()=>{
  const r=await fixtureModel({configure(db){db.history.lead=[senderNode({kind:'model',thread_id:'missing'})];}});
  let done!:()=>void;r.model.senderPageAfter(()=>new Promise<void>(resolve=>{done=resolve;}));
  r.model.applyRoute({view:'settings'});await settle(r.t,r.db);done();await settle(r.t,r.db);
  expect(r.model.senderTitles.values.value.size).toBe(0);expect(r.model.senderTitles.attemptCount).toBe(0);r.model.dispose();
});

it('resolves sender IDs in a freshly opened positional history window',async()=>{
  const r=await fixtureModel({capabilities:['history.window'],configure(db){
    const base=db.answer.bind(db);db.answer=c=>c.command==='history.window'?{ok:true,result:{thread_id:'lead',revision:1,total:1,items:[{...senderNode({kind:'model',thread_id:'window-sender'}),selection:{ordinal:0}}]}}:base(c);
  }});
  await settle(r.t,r.db);expect(r.model.senderTitles.values.value.get('window-sender')).toEqual({state:'unresolved'});
  expect(r.t.calls('thread.get').filter(c=>(c.args as {thread_id:string}).thread_id==='window-sender')).toHaveLength(1);
  r.model.dispose();
});
