import { expect, it, vi } from 'vitest';
import { fixtureModel, settle } from './fixture';
import { connected, details, flush } from '../../data/test/harness';

if (connected.state !== 'connected') throw new Error('fixture requires connected owner');
const ownerInfo = connected.info;

function deferred<T>() {
 let resolve!: (value: T) => void;
 const promise=new Promise<T>(done=>{resolve=done;});
 return {promise,resolve};
}
async function opened() {
 const r=await fixtureModel({capabilities:['thread.settings'],configure(db){db.details.lead!.effective_max_tokens=8192;db.details.child=details('child',{effective_max_tokens:2048});}});
 r.model.openModelPicker();await settle(r.t,r.db);return r;
}
function holdSave(r:Awaited<ReturnType<typeof opened>>) {
 const promise=r.model.saveThreadModel();
 const call=r.t.calls('thread.set').at(-1)!;expect(call).toBeDefined();
 r.db.answered.add(call.id);
 return {promise,call};
}
it.each(['success','error'] as const)('deferred %s A cannot affect reopened same-Thread B, including B saving state',async outcome=>{
 const r=await opened();
 try{
  const refresh=vi.spyOn(r.model.handle.peek()!,'refresh').mockResolvedValue();
  r.model.editThreadOutputLimit('100');const a=holdSave(r);
  r.model.closeModelPicker();r.model.openModelPicker();await settle(r.t,r.db);
  r.model.editThreadOutputLimit('200');const b=holdSave(r);const before=r.model.modelPicker.peek();
  if(outcome==='success')r.t.ok(a.call.id,r.db.details.lead!);else r.t.ownerError(a.call.id,'config_invalid','rejected A');
  await flush();await a.promise;
  expect(r.model.modelPicker.peek()).toBe(before);expect(refresh).not.toHaveBeenCalled();
  expect(r.t.cancels()).not.toContain(a.call.id);
  r.t.ownerError(b.call.id,'config_invalid','rejected B');await b.promise;
  expect(r.model.modelPicker.peek()).toMatchObject({open:true,maxTokens:'200',saving:false,error:'rejected B'});
 }finally{r.model.dispose();}
});
it('A already refreshing cannot close or change reopened B when the captured refresh finishes',async()=>{
 const r=await opened();const refreshDone=deferred<void>();const refreshStarted=deferred<void>();
 try{
  const refresh=vi.spyOn(r.model.handle.peek()!,'refresh').mockImplementation(()=>{refreshStarted.resolve();return refreshDone.promise;});
  const a=holdSave(r);r.t.ok(a.call.id,r.db.details.lead!);await refreshStarted.promise;
  r.model.closeModelPicker();r.model.openModelPicker();await settle(r.t,r.db);
  r.model.editThreadOutputLimit('300');const before=r.model.modelPicker.peek();
  refreshDone.resolve();await a.promise;
  expect(r.model.modelPicker.peek()).toBe(before);expect(refresh).toHaveBeenCalledTimes(1);
 }finally{refreshDone.resolve();r.model.dispose();}
});
it.each(['routeABA','ownerABA','capabilityLoss','handleReplacement'] as const)('invalidates the complete picker session on %s and refuses stale save admission',async change=>{
 const r=await opened();
 try{
  if(change==='routeABA'){
   const route=r.model.route.peek();r.model.navigate({view:'monitor'});r.model.navigate(route);
  }else if(change==='ownerABA'){
   const owner=r.model.data.owner.peek();expect(owner.state).toBe('connected');
   r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{...ownerInfo,instance_id:'i2',capabilities:['thread.settings']}}});
   r.t.push({t:'owner',event:'restarted',owner:owner as typeof connected});
  }else if(change==='capabilityLoss')r.t.push({t:'owner',event:'connected',owner:{state:'connected',info:{...ownerInfo,capabilities:[]}}});
  else r.model.handle.value=r.model.data.openThread('lead');
  await settle(r.t,r.db);
  expect(r.model.modelPicker.peek().open).toBe(false);
  const writes=r.t.calls('thread.set').length;await r.model.saveThreadModel();expect(r.t.calls('thread.set')).toHaveLength(writes);
 }finally{r.model.dispose();}
});
it('edited Thread effective placeholder never follows a different Thread detail',async()=>{
 const r=await opened();
 try{
  r.model.navigate({view:'conversation',threadId:'child'});await settle(r.t,r.db);
  expect(r.model.modelPicker.peek().open).toBe(false);
  r.model.openModelPicker();await settle(r.t,r.db);
  expect(r.model.modelPicker.peek().thread).toBe('child');
  expect(r.model.effectiveThreadSettings.peek().maxTokens).toBe(2048);
 }finally{r.model.dispose();}
});
it.each(['routeABA','ownerReplacement'] as const)('deferred accepted A cannot refresh into B after %s',async change=>{
 const r=await opened();
 try{
  const old=r.model.handle.peek()!;const refresh=vi.spyOn(old,'refresh').mockResolvedValue();
  const a=holdSave(r);
  if(change==='routeABA'){
   const route=r.model.route.peek();r.model.navigate({view:'monitor'});r.model.navigate(route);
  }else r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{...ownerInfo,instance_id:'i2',capabilities:['thread.settings']}}});
  await settle(r.t,r.db);r.model.openModelPicker();await settle(r.t,r.db);r.model.editThreadOutputLimit('400');
  const before=r.model.modelPicker.peek();r.t.ok(a.call.id,r.db.details.lead!);await flush();await a.promise;
  expect(r.model.modelPicker.peek()).toBe(before);expect(refresh).not.toHaveBeenCalled();
  expect(r.t.cancels()).not.toContain(a.call.id);
  expect(r.t.calls('thread.set')).toHaveLength(1);
 }finally{r.model.dispose();}
});
it('cannot open a new owner session using detail read under an earlier owner',async()=>{
 const r=await opened();
 try{
  r.model.closeModelPicker();
  r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{...ownerInfo,instance_id:'i2',capabilities:['thread.settings']}}});
  r.model.openModelPicker();expect(r.model.modelPicker.peek().open).toBe(false);
  await settle(r.t,r.db);r.model.openModelPicker();await settle(r.t,r.db);expect(r.model.modelPicker.peek().open).toBe(true);
 }finally{r.model.dispose();}
});
it('effective readback belongs to the captured edit observation, not a later same-Thread refresh',async()=>{
 const r=await opened();
 try{
  r.db.details.lead={...r.db.details.lead!,effective_max_tokens:4096};
  const refresh=r.model.handle.peek()!.refresh();await settle(r.t,r.db);await refresh;
  expect(r.model.threadSettings.peek()!.effectiveMaxTokens).toBe(4096);
  expect(r.model.effectiveThreadSettings.peek().maxTokens).toBe(8192);
  r.model.closeModelPicker();r.model.openModelPicker();await settle(r.t,r.db);
  expect(r.model.effectiveThreadSettings.peek().maxTokens).toBe(4096);
 }finally{r.model.dispose();}
});
it('detail observation is owner-epoch qualified without replacing the Window read qualification slot',async()=>{
 const r=await opened();
 try{
  const h=r.model.handle.peek()!;const windowToken=h.captureReadQualification()!;
  const observed=h.captureDetail()!;expect(observed.isCurrent()).toBe(true);
  expect(h.isReadQualificationCurrent(windowToken)).toBe(true);
  r.model.closeModelPicker();r.model.openModelPicker();await settle(r.t,r.db);
  expect(h.isReadQualificationCurrent(windowToken)).toBe(true);
  r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{...ownerInfo,instance_id:'i2',capabilities:['thread.settings']}}});
  expect(observed.isCurrent()).toBe(false);expect(h.captureDetail()).toBeUndefined();
  await settle(r.t,r.db);expect(h.captureDetail()!.isCurrent()).toBe(true);
 }finally{r.model.dispose();}
});
