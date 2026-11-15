import {expect,it} from 'vitest';
import {readbackFixture} from '../../data/test/readback-fixture';
import {canonicalAttemptId} from '../../data/test/work-fixture';

it.each(['completed','failed','incomplete','cancelled'] as const)('actual terminal %s persistence is observable but never retires a readable original',async terminalState=>{
 const r=await readbackFixture();r.state.attempt=canonicalAttemptId(1);r.state.terminalState=terminalState;
 try{
  r.live();r.end();await r.pump();const record=r.h.handoff.peek()[0]!,proof=r.receipt()!,before=r.window.acceptedView.peek();
  expect(proof).toMatchObject({scope:r.h.handoffScope(),attemptId:r.state.attempt,recordKey:record.key,presentationContainer:record.presentationContainer,
   terminalState,nodeIds:['tool','answer'],refs:[{nodeId:'tool',ordinal:0,kind:'assistant_response'},{nodeId:'answer',ordinal:1,kind:'assistant_response'}]});
  expect(before.rows.map(row=>row.node_id)).toEqual(['human']);expect(before.rows[0]?.items).toMatchObject([{kind:'text',text:'Independent human',text_complete:true}]);
  let releases=0;
  expect(r.h.transferHandoff(r.state.attempt,()=>{releases++;return true;})).toBe(false);
  expect(r.window.acceptHandoff({...record,terminalPersisted:proof},r.h.handoffScope(),()=>{releases++;})).toBe(false);
  expect(releases).toBe(0);expect(r.window.acceptedView.peek()).toBe(before);
  expect(r.h.handoff.peek()[0]).toBe(record);expect(record.text).toBe('whole live block');expect(before.retiredAttempts??[]).toEqual([]);
  expect(before.terminalPresence).toMatchObject([{phase:'pending',reason:'canonical-pending',answerAvailability:'unknown'}]);
  expect(r.bodyReads()).toHaveLength(0);
 }finally{r.data.stop();}
});
it.each(['empty','wrongscope','wrongattempt','revoke'] as const)('public persistence copy cannot confer transfer authority under %s',async mode=>{
 const r=await readbackFixture();
 try{
  r.live();r.end();await r.pump();const original=r.h.handoff.peek()[0]!,receipt=r.receipt()!,before=r.window.acceptedView.peek();
  const proof=mode==='empty'?{...receipt,nodeIds:[],refs:[]}:receipt;
  const record={...original,attemptId:mode==='wrongattempt'?'other':original.attemptId,terminalPersisted:proof};
  if(mode==='revoke')r.window.acceptedView.revoke();
  let releases=0;expect(r.window.acceptHandoff(record,mode==='wrongscope'?'foreign':r.h.handoffScope(),()=>{releases++;})).toBe(false);
  expect(releases).toBe(0);expect(r.window.acceptedView.peek()).toBe(before);expect(r.h.handoff.peek()[0]).toBe(original);
  if(mode==='revoke')expect(r.window.acceptedView.isCurrent(before)).toBe(false);
  else expect(r.window.acceptedView.isCurrent(before)).toBe(true);
 }finally{r.data.stop();}
});
