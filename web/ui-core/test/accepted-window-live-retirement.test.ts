import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { createBoundWindow, rig } from "./window-owner";
import { canonicalAttemptId } from "../../data/test/work-fixture";
import { captureConversationInput, captureCurrentWork } from "../src/conversation-input";

describe("production accepted window live retirement", () => {
  it("releases the matching live attempt only after accepted saved rows commit", async () => {
    const f = await rig(20);
    f.owner.decorate = (i, item) => i === 19 ? { ...item, kind: "assistant_response", provenance: { attempt_id: canonicalAttemptId(1) } } : item;
    f.w.bindCurrentThread(f.handle);
    f.t.push({ t: "live", thread_id: "t", attempt_id: canonicalAttemptId(1), gap: false, deltas: [{ offset: 0, reasoning: false, text: "live answer" }] });
    await flush();
    expect(f.handle.handoff.value.some(record => record.attemptId === canonicalAttemptId(1))).toBe(true);
    f.w.changed();
    await f.settle();
    expect(f.handle.handoff.value.some(record => record.attemptId === canonicalAttemptId(1))).toBe(false);
    f.w.dispose();
    f.data.stop();
  });

  it("accepted plan multiplicity retires one matching live record from one to zero", async () => {
    const f = await rig(20);
    const attempt = canonicalAttemptId(1);
    f.w.bindCurrentThread(f.handle);
    f.w.bindConversationInput(snapshot => captureConversationInput(snapshot, {
      scope: "history", threadId: "t", records: f.handle.handoff.value,
      work: captureCurrentWork("t", undefined), current: () => true,
    }));
    f.t.push({ t: "live", thread_id: "t", attempt_id: attempt, gap: false, deltas: [{ offset: 0, reasoning: false, text: "live answer" }] });
    await flush();
    f.w.changed();
    await f.settle();
    const liveEntries = () => f.w.acceptedView.peek().displayPlan?.entries.filter(entry => {
      const source = entry.item.source;
      return "domain" in source && source.domain === "live" && source.attemptId === attempt;
    }) ?? [];
    expect(liveEntries()).toHaveLength(1);
    expect(f.handle.handoff.value.filter(record => record.attemptId === attempt)).toHaveLength(1);
    f.owner.decorate = (i, item) => i === 19 ? { ...item, kind: "assistant_response", provenance: { attempt_id: attempt } } : item;
    f.w.changed();
    await f.settle();
    const accepted = f.w.acceptedView.peek();
    expect(accepted.rows.filter(row => row.node_id === f.owner.nodeId(19))).toHaveLength(1);
    expect(accepted.displayPlan?.entries.filter(entry => entry.item.source.nodeId === f.owner.nodeId(19))).toHaveLength(1);
    expect(liveEntries()).toHaveLength(0);
    expect(f.handle.handoff.value.filter(record => record.attemptId === attempt)).toHaveLength(0);
    f.w.dispose();
    f.data.stop();
  });
});


it('preserves missing, mismatched, foreign-scope, and revoked live records while retiring only the matching attempt',async()=>{
 const f=await rig(2);const match=canonicalAttemptId(1),other=canonicalAttemptId(2);f.w.bindCurrentThread(f.handle);
 f.t.push({t:'live',thread_id:'t',attempt_id:match,gap:false,deltas:[{offset:0,reasoning:false,text:'matching'}]});
 f.t.push({t:'live',thread_id:'t',attempt_id:other,gap:false,deltas:[{offset:0,reasoning:false,text:'other'}]});await flush();
 expect(f.handle.handoff.value.map(record=>record.attemptId)).toEqual(expect.arrayContaining([match,other]));
 f.owner.decorate=(i,item)=>i===1?{...item,kind:'assistant_response',provenance:{attempt_id:match}}:item;f.w.changed();await f.settle();
 expect(f.handle.handoff.value.some(record=>record.attemptId===match)).toBe(false);expect(f.handle.handoff.value.some(record=>record.attemptId===other)).toBe(true);
 const before=f.handle.handoff.value.length;f.w.acceptedView.revoke();f.owner.append(1);f.w.changed();await f.settle();
 expect(f.handle.handoff.value.length).toBeGreaterThanOrEqual(before);f.w.dispose();f.data.stop();
});


async function liveCase(attempt:string){const f=await rig(2);f.w.bindCurrentThread(f.handle);f.t.push({t:'live',thread_id:'t',attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:attempt}]});await flush();return f}

it('missing attempt provenance preserves live identity through production commit',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'}}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
it('different attempt preserves live identity through production commit',async()=>{const attempt=canonicalAttemptId(1),other=canonicalAttemptId(2),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:other}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
it('foreign current handle does not retire the old live identity',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt),foreign=await rig(2);try{const before=f.handle.handoff.value[0]!;expect(f.w.bindCurrentThread(foreign.handle)).toBe(false);f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:attempt}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop();foreign.w.dispose();foreign.data.stop()}});
it('revoke preserves live identity before a publication reply arrives',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.w.acceptedView.revoke();f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:attempt}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);expect(f.w.acceptedView.isCurrent(f.w.acceptedView.peek())).toBe(false)}finally{f.w.dispose();f.data.stop()}});


it("semantic lease cancellation rejects publication and preserves accepted ref/live identity", async () => {
 const attempt=canonicalAttemptId(1),f=await rig(2);let w!:typeof f.w;try{
 f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:"live"}]});await flush();f.w.dispose();
 let armed=false,phase="idle";
 const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records:f.handle.handoff.value,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>{
  if(!armed)return w.isCurrentThread(f.handle);
  if(phase==="capture"){phase="lease";return w.isCurrentThread(f.handle);}
  f.handle.cancelReads();return true;
 }})};
 w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();
 const beforeRef=w.acceptedView.peek(),beforeRows=beforeRef.rows,before=f.handle.handoff.value[0]!;
 f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:canonicalAttemptId(2),gap:false,deltas:[{offset:0,reasoning:false,text:"semantic change"}]});await flush();
 const afterSecond=f.handle.handoff.value.slice();expect(beforeRows.length).toBeGreaterThan(0);expect(afterSecond).toHaveLength(2);expect(w.acceptedView.isCurrent(beforeRef)).toBe(true);
 armed=true;phase="capture";expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);expect(w.acceptedView.peek().rows).toBe(beforeRows);expect(f.handle.handoff.value).toHaveLength(afterSecond.length);expect(f.handle.handoff.value[0]).toBe(afterSecond[0]);expect(f.handle.handoff.value[1]).toBe(afterSecond[1]);
 }finally{w?.dispose();f.data.stop();}
});

it("semantic callback rebind rejection preserves accepted ref/rows/live identity", async () => {
 const attempt=canonicalAttemptId(1),f=await rig(2),foreign=await rig(2);let w!:typeof f.w;try{
 f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:"live"}]});await flush();f.w.dispose();let armed=false,phase="idle",callbackHits=0;
 const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records:f.handle.handoff.value,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>{callbackHits++;if(!armed)return w.isCurrentThread(f.handle);if(phase==="capture"){phase="lease";return w.isCurrentThread(f.handle);}expect(w.bindCurrentThread(foreign.handle)).toBe(false);return true;}})};
 w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();f.producer.advance(canonicalAttemptId(2));await flush();expect(w.bindCurrentThread(f.handle)).toBe(true);const beforeRef=w.acceptedView.peek(),beforeRows=beforeRef.rows,before=f.handle.handoff.value[0]!;expect(beforeRows.length).toBeGreaterThan(0);armed=true;phase="capture";expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);expect(w.acceptedView.peek().rows).toBe(beforeRows);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);expect(callbackHits).toBeGreaterThanOrEqual(2);
 }finally{w?.dispose();f.data.stop();foreign.w.dispose();foreign.data.stop();}
});

it("semantic false rejects publication with seeded accepted ref/live identity", async () => {
 const attempt=canonicalAttemptId(1),f=await rig(2);let w!:typeof f.w;try{f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:"live"}]});await flush();f.w.dispose();let armed=false;
 const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records:f.handle.handoff.value,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>armed?false:w.isCurrentThread(f.handle)})};
 w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();
 const beforeRef=w.acceptedView.peek(),before=f.handle.handoff.value[0]!;armed=true;expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);}finally{w?.dispose();f.data.stop();}
});

it('rejected publication reply preserves accepted ref and live identity',async()=>{
 const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const beforeRef=f.w.acceptedView.peek(),before=f.handle.handoff.value[0]!;f.owner.append(1);f.w.changed();await flush();const call=f.calls().filter(item=>item.command==='history.window'&&!f.owner.answered.has(item.id)).at(-1);expect(call).toBeDefined();f.w.acceptedView.revoke();f.owner.answered.add(call!.id);const answer=f.owner.answer(call!);expect(answer.ok).toBe(true);if(answer.ok)f.t.ok(call!.id,answer.result);await flush(8);expect(f.w.acceptedView.peek()).toBe(beforeRef);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});

it("preserves canonical prefix and captured live suffix across accepted replacement", async () => {
 const f=await rig(18),a=canonicalAttemptId(1),b=canonicalAttemptId(2),c=canonicalAttemptId(3);
 try {
  f.w.bindCurrentThread(f.handle);
  for (const attempt of [a,b,c]) f.t.push({t:"live",thread_id:"t",attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:attempt}]});
  await flush();f.w.changed();await f.settle();
  const ids=()=>f.w.acceptedView.peek().displayPlan?.entries.map(entry=>{const source=entry.item.source;return "domain" in source?source.recordId:source.nodeId;}).filter((id):id is string=>id!==undefined) ?? [];
  const before=ids(), prefix=before.slice(0,18), liveA=`handoff:${a}`,liveB=`handoff:${b}`,liveC=`handoff:${c}`;
  expect(before).toEqual([...prefix,liveA,liveB,liveC]);
  const beforeB=f.handle.handoff.value.find(record=>record.attemptId===b)!,beforeC=f.handle.handoff.value.find(record=>record.attemptId===c)!;
  f.owner.append(2);
  f.owner.decorate=(i,item)=>i===18?{...item,kind:"assistant_response",provenance:{attempt_id:a},items:[{kind:"text",item_identity:"first",text:"A1",text_complete:true},{kind:"text",item_identity:"second",text:"A2",text_complete:true}]}:i===19?{...item,kind:"user",items:[{kind:"text",item_identity:"next",text:"Next user",text_complete:true}]}:item;
  f.w.changed();await f.settle(()=>f.w.acceptedView.peek().revision===f.owner.revision && f.w.acceptedView.peek().rows.some(row=>row.node_id===f.owner.nodeId(18)));
  const savedA=f.owner.nodeId(18),nextUser=f.owner.nodeId(19),expected=[...prefix,savedA,savedA,nextUser,liveB,liveC];
  expect(ids()).toEqual(expected);expect(f.handle.handoff.value.find(record=>record.attemptId===a)).toBeUndefined();
  expect(f.handle.handoff.value.find(record=>record.attemptId===b)).toBe(beforeB);expect(f.handle.handoff.value.find(record=>record.attemptId===c)).toBe(beforeC);
  f.w.changed();await f.settle();expect(ids()).toEqual(expected);expect(f.handle.handoff.value.find(record=>record.attemptId===b)).toBe(beforeB);expect(f.handle.handoff.value.find(record=>record.attemptId===c)).toBe(beforeC);
 } finally { f.w.dispose();f.data.stop(); }
});

it("records live text changes during a lease and accepts a fresh same-window capture", async () => {
 const a=canonicalAttemptId(1),f=await liveCase(a);let w!:typeof f.w;
 try {
  f.w.dispose();let armed=false,phase="initial";
  const input={state:f.producer,capture:(snapshot:import("../src/window").WindowAcceptedSnapshot)=>{const records=f.handle.handoff.value;return captureConversationInput(snapshot,{scope:f.handle.threadId,threadId:f.handle.threadId,records,work:captureCurrentWork(f.handle.threadId,f.handle.work.value.value),current:()=>{const current=w.isCurrentThread(f.handle)&&f.handle.handoff.peek()===records;if(!armed)return current;if(phase==="initial"){phase="leased";f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:a,gap:false,deltas:[{offset:2,reasoning:false,text:`${a}-lease`}]});return w.isCurrentThread(f.handle)&&f.handle.handoff.peek()===records;}return current;}})}};
  w=createBoundWindow({read:(args,cancel)=>f.handle.readWindow(args,cancel)},f.handle,input);await f.settle();
  const beforeRef=w.acceptedView.peek(),beforeRecord=f.handle.handoff.value.find(record=>record.attemptId===a)!;expect(beforeRecord.text).toBe(a);armed=true;f.t.push({t:"live",thread_id:f.handle.threadId,attempt_id:a,gap:false,deltas:[{offset:1,reasoning:false,text:`${a}-delta`}]});await flush();
  expect(w.refreshConversationInput(beforeRef)).toBe(false);expect(w.acceptedView.peek()).toBe(beforeRef);const changed=f.handle.handoff.value.find(record=>record.attemptId===a)!;expect(changed).not.toBe(beforeRecord);expect(changed.text.length).toBeGreaterThan(beforeRecord.text.length);expect(w.refreshConversationInput(w.acceptedView.peek())).toBe(true);expect(w.acceptedView.peek()).not.toBe(beforeRef);expect(w.isCurrentThread(f.handle)).toBe(true);
 } finally { w?.dispose();f.data.stop(); }
});

it("collapses a saved tool association without leaving a matching live preview", async () => {
 const attempt=canonicalAttemptId(4),f=await rig(3);
 try {
  f.owner.decorate=(i,item)=>i===0?{...item,kind:"assistant_response",items:[{kind:"tool_call",item_identity:"tool",execution_ids:["shared"]}]}:i===1?{...item,kind:"assistant_response",provenance:{attempt_id:attempt},items:[{kind:"tool_call",item_identity:"tool",execution_ids:["shared"]}]}:item;
  f.producer.advance(attempt);await flush();f.w.changed();await f.settle();
  const entries=f.w.acceptedView.peek().displayPlan?.entries ?? [];
  expect(entries.some(entry=>"domain" in entry.item.source&&entry.item.source.attemptId===attempt)).toBe(false);
  expect(entries.some(entry=>entry.item.source.nodeId===f.owner.nodeId(0)&&entry.item.source.kind==="tool")).toBe(true);
  expect(entries.some(entry=>entry.item.source.nodeId===f.owner.nodeId(2))).toBe(true);
  expect(f.handle.handoff.value.some(record=>record.attemptId===attempt)).toBe(false);
 }finally{f.w.dispose();f.data.stop();}
});
