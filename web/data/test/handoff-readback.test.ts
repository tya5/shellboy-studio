import { expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "./harness";
import {readbackFixture as rig} from './readback-fixture';
import {CANONICAL_ATTEMPT_ID} from './work-fixture';

it("stages exact public persistence before an incomplete output cut without replacing stream text", async () => {
  const r = await rig(); r.live(); r.end(); await r.pump();
  const record = r.h.handoff.value[0]!;
  expect(record.text).toBe("whole live block"); expect(record.proof).toBeUndefined();
  expect(record.readyAttempt).toBeUndefined();
  expect(r.receipt()).toMatchObject({ scope: r.h.handoffScope(), attemptId: CANONICAL_ATTEMPT_ID, turnId: "turn",
    terminalState: "completed", nodeIds: ["tool", "answer"] });
  expect(r.t.calls("history.get")).toHaveLength(0);
  expect(r.bodyReads()).toHaveLength(0); r.data.stop();
});
for (const mode of ["truncated", "partial", "deferred", "unknown", "missing", "error", "changing", "empty"] as const) it(`keeps original capture text while qualifying terminal persistence with incomplete public output despite ${mode} body probe`, async () => {
  const r = await rig(); r.state[mode] = true; r.live(); r.end(); await r.pump();
  expect(r.h.handoff.value[0]?.text).toBe("whole live block"); expect(r.h.handoff.value[0]?.readyAttempt).toBeUndefined();
  if (mode === "empty") expect(r.receipt()).toBeUndefined();
  else expect(r.receipt()?.nodeIds).toEqual(["tool", "answer"]);
  expect(r.t.calls("history.get")).toHaveLength(0); r.data.stop();
});
it("keeps the original capture while status authority is held, then stages persistence without a typed read", async () => {
  const r = await rig(); r.live(); r.end();
  // Persistence is not authorized until this original status request completes.
  for (let n = 0; n < 10; n++) {
    for (const call of r.t.calls().filter(call => !r.db.answered.has(call.id) && call.command !== "status")) { const out = r.db.answer(call); r.db.answered.add(call.id); if (out.ok) r.t.ok(call.id, out.result); else r.t.ownerError(call.id, out.code, out.message); }
    await flush();
  }
  expect(r.t.calls("status").some(call => !r.db.answered.has(call.id))).toBe(true);
  expect(r.h.handoff.value[0]?.text).toBe("whole live block"); expect(r.h.handoff.value[0]?.readyAttempt).toBeUndefined();
  expect(r.receipt()).toBeUndefined();
  await r.pump();
  expect(r.receipt()?.nodeIds).toEqual(["tool", "answer"]);
  expect(r.bodyReads()).toHaveLength(0); r.data.stop();
});
for (const action of ["cancel", "close", "pause", "ownerABA"] as const) it(`rejects original lookup continuation after ${action}`, async () => {
  const r = await rig(); r.live(); r.end();
  if (action === "cancel") r.h.cancelReads(); else if (action === "close") r.h.close(); else if (action === "pause") r.h.pause(); else { r.t.push({ t: "owner", event: "restarted", owner: connected }); r.t.push({ t: "owner", event: "restarted", owner: connected }); }
  await r.pump(); expect(r.h.handoff.value.some(record => record.readyAttempt || record.terminalPersisted)).toBe(false);expect(r.receipt()).toBeUndefined(); r.data.stop();
});
it("hints cannot refill eight starts and explicit retry preserves original attempt", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await r.pump();
  for (let n = 0; n < 20; n++) { r.t.push({ t: "changed", thread_ids: ["a"], list: false }); await r.pump(); }
  expect(r.t.calls("status")).toHaveLength(8);
  r.state.available = true; const retry = r.h.retryHandoff(); await r.pump(); await retry;
  expect(r.receipt()).toMatchObject({ scope: r.h.handoffScope(), attemptId: CANONICAL_ATTEMPT_ID, terminalState: "completed" });
  expect(r.t.calls("status")).toHaveLength(9);
  expect(r.bodyReads()).toHaveLength(0);
  expect(r.t.calls("history.get")).toHaveLength(0); r.data.stop();
});

for(const mode of ['partial','deferred','unknown','missing','error','changing'] as const)it(`complete public output refuses ${mode} body proof without changing original bytes`,async()=>{
 const r=await rig();r.state.truncated=false;r.state[mode]=true;
 try{r.live();r.end();await r.pump();
  expect(r.h.handoff.peek()[0]?.text).toBe('whole live block');expect(r.h.handoff.peek()[0]?.readyAttempt).toBeUndefined();
  expect(r.receipt()).toMatchObject({nodeIds:['tool','answer']});
  expect(r.bodyReads()).toHaveLength(mode==='missing'||mode==='changing'?2:1);
  expect(r.t.calls('history.get')).toHaveLength(0);
  expect(r.window.acceptedView.peek().revision).toBe(6);
  expect(r.window.acceptedView.peek().rows.map(node=>node.node_id)).toEqual(['human']);
  expect(r.window.acceptedView.peek().rows[0]?.items).toEqual([{kind:'text',item_identity:'human-text',text:'Independent human',text_complete:true}]);
 }finally{r.data.stop();}
});
it('complete public output stages exact readable tuples once without retiring the held original',async()=>{
 const r=await rig();r.state.truncated=false;
 try{r.live();r.end();await r.pump();const record=r.h.handoff.peek()[0]!;
  expect(record.text).toBe('whole live block');expect(record.readyAttempt).toMatchObject({revision:7,total:2,
   refs:[{nodeId:'tool',ordinal:0,kind:'assistant_response'},{nodeId:'answer',ordinal:1,kind:'assistant_response'}]});
  expect(r.bodyReads()).toHaveLength(1);expect(r.h.handoff.peek()).toHaveLength(1);
 }finally{r.data.stop();}
});

it('keeps B canonical handoff progress across A global resolver busy without a second hint',async()=>{
 const r=await rig({threadIds:['a','b']});
 try{
  const a=r.handles.a!,b=r.handles.b!;
  r.liveFor('a');r.endFor('a');await flush();
  const statusA=r.t.calls('status').find(call=>(call.args as {thread_id?:string}).thread_id==='a');
  expect(statusA).toBeDefined();
  r.liveFor('b');r.endFor('b');await flush();
  expect(r.t.calls('status').some(call=>(call.args as {thread_id?:string}).thread_id==='b')).toBe(false);
  const bBefore=b.handoff.peek()[0]!;expect(bBefore.status).toBe('confirming');
  const aResult=r.db.answer(statusA!);r.db.answered.add(statusA!.id);if(aResult.ok)r.t.ok(statusA!.id,aResult.result);else r.t.ownerError(statusA!.id,aResult.code,aResult.message);
  for(let n=0;n<20;n++){
   const aCalls=r.t.calls().filter(call=>!r.db.answered.has(call.id)&&(call.args as {thread_id?:string}).thread_id==='a');
   if(!aCalls.length)break;
   for(const call of aCalls){const result=r.db.answer(call);r.db.answered.add(call.id);if(result.ok)r.t.ok(call.id,result.result);else r.t.ownerError(call.id,result.code,result.message);}
   await flush();
  }
  expect(r.t.calls().some(call=>!r.db.answered.has(call.id)&&(call.args as {thread_id?:string}).thread_id==='a')).toBe(false);
  const bStatus=r.t.calls('status').find(call=>(call.args as {thread_id?:string}).thread_id==='b');
  expect(bStatus).toBeDefined();
  await r.pump();
  expect(r.db.answered.has(bStatus!.id)).toBe(true);
  expect(b.handoff.peek()[0]?.status).toBe('confirming');
 }finally{r.data.stop();}
});


it('retains same-entry dirty work until the current resolver admits it',async()=>{
 const r=await rig();
 try{
  r.live();r.end();await flush();
  const status=r.t.calls('status').find(call=>(call.args as {thread_id?:string}).thread_id==='a');
  expect(status).toBeDefined();
  r.live();r.end();await flush();
  expect(r.t.calls('status').filter(call=>(call.args as {thread_id?:string}).thread_id==='a')).toHaveLength(1);
  expect(r.t.calls('status')).toHaveLength(1);
  expect(r.h.handoff.peek()).toHaveLength(1);
  const result=r.db.answer(status!);r.db.answered.add(status!.id);
  if(result.ok)r.t.ok(status!.id,result.result);else r.t.ownerError(status!.id,result.code,result.message);
  await r.pump();
  expect(r.h.handoffRetryState.peek().phase).not.toBe('reading');
  expect(r.t.calls('status').filter(call=>(call.args as {thread_id?:string}).thread_id==='a').length).toBeGreaterThan(1);
 }finally{r.data.stop();}
});
