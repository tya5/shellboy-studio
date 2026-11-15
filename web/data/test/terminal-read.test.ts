import { Handoff, type AttemptReadyProof } from "../src/handoff";
import { expect, it } from "vitest";
import { TerminalReadSlots, type SelectedCanonicalRequest, type OwnedTerminalReadLease } from "../src/terminal-read";
import { HistoryWindowInput } from "../src/history-input";
import { Cancel } from "../src/operations";
const receipt = { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" as const };
const request = { id: "r", args: { thread_id: "t", items: true, before: 99, after: 100 } } as SelectedCanonicalRequest;
const result = { ok: true as const, value: { thread_id: "t", revision: 1, total: 0, items: [] } };
it("two leases coalesce one bounded read, third denied", async () => {
 const slots = new TerminalReadSlots(), cancel = new Cancel();
 const a = slots.request({ kind: "persisted", receipt }, request, () => true, cancel) as OwnedTerminalReadLease;
 const b = slots.request({ kind: "persisted", receipt }, request, () => true, cancel) as OwnedTerminalReadLease;
 expect(slots.request({ kind: "persisted", receipt }, request, () => true, cancel)).toEqual({ phase: "unavailable", reason: "capacity" });
 let starts = 0; await slots.dispatch(() => { starts++; return true; }, async () => result);
 expect(starts).toBe(1); expect(a.state.peek()).toEqual(b.state.peek());
 expect(a.state.peek().phase).toBe("settled"); await slots.dispatch(() => { starts++; return true; }, async () => result); expect(starts).toBe(1);
});
it("cancel then prepare cannot reset automatic-once even before dispatch", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); const a = slots.request({ kind: "persisted", receipt }, request, () => true, parent) as OwnedTerminalReadLease;
 a.cancel(); const b = slots.request({ kind: "persisted", receipt }, request, () => true, parent) as OwnedTerminalReadLease;
 expect(b.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" }); let reads = 0;
 await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0);
 expect(slots.request({ kind: "persisted", receipt }, { ...request, id: "new" as SelectedCanonicalRequest["id"] }, () => true, parent)).toEqual({ phase: "unavailable", reason: "cancelled" });
});
it("budget denial settles without dispatch and no automatic retry", async () => {
 const slots = new TerminalReadSlots(); const lease = slots.request({ kind: "persisted", receipt }, request, () => true, new Cancel()) as OwnedTerminalReadLease;
 let reads = 0; await slots.dispatch(() => false, async () => { reads++; return result; });
 expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "budget-exhausted" });
 await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0);
});
it("invalidated held result cannot publish into its old lease", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); let valid = true;
 const lease = slots.request({ kind: "persisted", receipt }, request, () => valid, parent) as OwnedTerminalReadLease;
 let finish!: (value: typeof result) => void; const done = slots.dispatch(() => true, () => new Promise(resolve => { finish = resolve; }));
 valid = false; parent.cancel(); finish(result); await done;
 expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" });
});
it.each([{ items: false, before: 0, after: 0 }, { items: true, before: 100, after: 100 }, { items: true, before: -1, after: 0 }])("rejects invalid typed node request %#", args => {
 expect(new TerminalReadSlots().request({ kind: "persisted", receipt }, { ...request, args: { thread_id: "t", ...args } }, () => true, new Cancel())).toEqual({ phase: "unavailable", reason: "capacity" });
});
it("clear invalidates every old lease and keeps no queued work", async () => {
 const slots = new TerminalReadSlots(); const lease = slots.request({ kind: "persisted", receipt }, request, () => true, new Cancel()) as OwnedTerminalReadLease;
 slots.clear(); expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" });
 let reads = 0; await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0);
});
it("reading notification revocation prevents dispatch", async () => {
 const slots = new TerminalReadSlots(); let valid = true; const lease = slots.request({ kind: "persisted", receipt }, request, () => valid, new Cancel()) as OwnedTerminalReadLease;
 const stop = lease.state.subscribe(state => { if (state.phase === "reading") valid = false; });
 let reads = 0; await slots.dispatch(() => true, async () => { reads++; return result; }); expect(reads).toBe(0); stop();
});
it("same ID with changed selected args cannot coalesce", () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); slots.request({ kind: "persisted", receipt }, request, () => true, parent);
 expect(slots.request({ kind: "persisted", receipt }, { ...request, args: { ...request.args, before: 1 } }, () => true, parent)).toEqual({ phase: "unavailable", reason: "cancelled" });
});
it("only explicit manual owner reset can admit a new automatic marker in a retained receipt scope", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); const old = slots.request({ kind: "persisted", receipt }, request, () => true, parent) as OwnedTerminalReadLease;
 old.cancel(); let starts = 0; await slots.dispatch(() => true, async () => { starts++; return result; }); expect(starts).toBe(0);
 // Store invokes clear only after the existing explicit retry invalidates old qualification.
 slots.clear(); const next = slots.request({ kind: "persisted", receipt }, request, () => true, parent) as OwnedTerminalReadLease;
 await slots.dispatch(() => true, async () => { starts++; return result; }); expect(starts).toBe(1); expect(next.state.peek().phase).toBe("settled");
});
it("settled successor is dispatched once without resolver re-entry", async () => {
 const slots = new TerminalReadSlots(), parent = new Cancel(); let reads = 0;
 const old = slots.request({ kind: "persisted", receipt }, request, () => true, parent) as OwnedTerminalReadLease;
 old.state.subscribe(state => {
   if (state.phase === "settled") slots.replace({ kind: "persisted", receipt }, { ...request, id: "fresh" as SelectedCanonicalRequest["id"] }, () => true, parent);
 });
 await slots.dispatch(() => true, async () => { reads++; return { ...result, value: { ...result.value, revision: reads } }; });
 expect(reads).toBe(2);
 expect(slots.queued).toBe(false);
});


it.each(['current','replace','revoke'] as const)('ready selected slot gates finite completion on exact %s record', async mode => {
 const h=new Handoff(f=>f()); h.apply({attempt_id:'a',gap:false,deltas:[{offset:0,reasoning:false,text:'preview'}]}); h.finish();
 const original=h.records.peek()[0]!;
 const proof:AttemptReadyProof={scope:'s',attemptId:'a',turnId:'turn',revision:1,total:1,refs:[{nodeId:'n',ordinal:0,kind:'assistant_response'}],
   nodes:[{node_id:'n',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'i',text:'saved',text_complete:true}]}]};
 const staged=h.stageAttempt(original,proof)!;
 const slots=new TerminalReadSlots(), parent=new Cancel();
 const admitted=slots.request({kind:'ready',record:staged,scope:'s'},request,()=>h.isReadyReadCurrent(staged,'s'),parent);
 expect('state' in admitted).toBe(true); if(!('state' in admitted))throw Error('not admitted');
 let finish!:(value:typeof result)=>void;
 const done=slots.dispatch(()=>true,()=>new Promise(resolve=>{finish=resolve;}));
 if(mode==='replace')h.stageAttempt(staged,{...proof}); else if(mode==='revoke')h.invalidate();
 finish(result); await done;
 expect(admitted.state.peek().phase==='settled').toBe(mode==='current');
 expect(slots.isCurrent(admitted)).toBe(mode==='current');
 expect(slots.request({kind:'ready',record:{...staged},scope:'s'},request,()=>h.isReadyReadCurrent({...staged},'s'),parent))
   .toEqual({phase:'unavailable',reason:'cancelled'});
});


it('ticket identity alone cannot forge ownership and a cancelled lease cannot borrow its sibling',()=>{
 const slots=new TerminalReadSlots(),parent=new Cancel();
 const first=slots.request({kind:'persisted',receipt},request,()=>true,parent) as OwnedTerminalReadLease;
 const sibling=slots.request({kind:'persisted',receipt},request,()=>true,parent) as OwnedTerminalReadLease;
 expect(slots.isCurrent({...first})).toBe(false); expect(slots.isCurrent(first)).toBe(true);
 first.cancel(); expect(slots.isCurrent(first)).toBe(false); expect(slots.isCurrent(sibling)).toBe(true);
 sibling.cancel(); expect(slots.isCurrent(sibling)).toBe(false);
});
it('a revoked settled marker cannot be replaced to mint fresh automatic permission',async()=>{
 const slots=new TerminalReadSlots(),parent=new Cancel();let current=true;
 slots.request({kind:'persisted',receipt},request,()=>current,parent);
 await slots.dispatch(()=>true,async()=>result);current=false;
 expect(slots.replace({kind:'persisted',receipt},{...request,id:'revoked-successor' as SelectedCanonicalRequest['id']},()=>true,parent))
   .toEqual({phase:'unavailable',reason:'cancelled'});
 expect(slots.queued).toBe(false);
});

it('the existing ticket owns an immutable selected plan and equal RPC args cannot rebind its revision',()=>{
 const slots=new TerminalReadSlots(),parent=new Cancel(),selection={first:0,last:2,revision:2};
 const selected={...request,args:{thread_id:'t',ordinal:0,before:0,after:2,items:true},selection};
 const lease=slots.request({kind:'persisted',receipt},selected,()=>true,parent);
 if(!('state' in lease))throw new Error('Expected an actual selected lease');
 selection.first=1;
 expect(lease.ticket.request.selection).toEqual({first:0,last:2,revision:2});expect(Object.isFrozen(lease.ticket.request.selection)).toBe(true);
 expect(slots.request({kind:'persisted',receipt},{...selected,selection:{first:0,last:2,revision:3}},()=>true,parent)).toEqual({phase:'unavailable',reason:'cancelled'});
 expect(slots.isCurrent(lease)).toBe(true);
});

it.each([201,1600])('one actual selected lease assembles %i rows from original <=200-row pages at one revision',async count=>{
 const slots=new TerminalReadSlots(),parent=new Cancel(),first=400;
 const selected={...request,args:{thread_id:'t',ordinal:first,before:0,after:199,items:true},selection:{first,last:first+count-1,revision:2}};
 const lease=slots.request({kind:'persisted',receipt},selected,()=>true,parent);
 if(!('state' in lease))throw new Error('Expected actual paged lease');
 let budget=8;const calls:{ordinal?:number;before?:number;after?:number}[]=[],states:string[]=[];
 const stop=lease.state.subscribe(state=>states.push(state.phase));
 await slots.dispatch(()=>budget>0&&(budget--,true),async args=>{
  calls.push(args);const start=args.ordinal??-1,n=(args.after??0)+1;
  return{ok:true,value:{thread_id:'t',revision:2,total:2400,items:Array.from({length:n},(_,index)=>({node_id:`node-${start+index}`,kind:'assistant_response',selection:{ordinal:start+index},
   items:[{kind:'text',item_identity:'body',text:`R2:${start+index}`,text_complete:true},{kind:'text',item_identity:'detail',text:`detail-${start+index}`,text_complete:true}],provenance:{message:{reply_to:'prior',expect_reply:false}}}))}};
 });
 const out=lease.state.peek();expect(out.phase).toBe('settled');
 if(out.phase!=='settled'||!out.result.ok)throw new Error('Missing complete paged result');
 expect(out.result.value.items).toHaveLength(count);expect(out.result.value.items.at(-1)?.provenance?.message).toMatchObject({reply_to:'prior'});expect(out.result.value.items.map(row=>row.selection?.ordinal)).toEqual(Array.from({length:count},(_,i)=>first+i));
 expect(calls).toHaveLength(Math.ceil(count/200));expect(budget).toBe(7);expect(calls.every(args=>args.before===0&&(args.after??200)<200)).toBe(true);
 expect(states.filter(state=>state==='settled')).toHaveLength(1);expect(slots.isCurrent(lease)).toBe(true);stop();
});
it('joined validated pages preserve rich rows without reusing the aggregate raw visit bound',async()=>{
 const slots=new TerminalReadSlots(),parent=new Cancel();const selected={...request,args:{thread_id:'t',ordinal:0,before:0,after:199,items:true},selection:{first:0,last:399,revision:2}};
 const lease=slots.request({kind:'persisted',receipt},selected,()=>true,parent);if(!('state' in lease))throw new Error('Expected actual paged lease');let reads=0;
 await slots.dispatch(()=>true,async args=>{const first=args.ordinal??0;const n=(args.after??0)+1;reads++;return{ok:true,value:{thread_id:'t',revision:2,total:400,items:Array.from({length:n},(_,i)=>({node_id:`rich-${first+i}`,kind:'assistant_response',selection:{ordinal:first+i},items:[{kind:'text',item_identity:'a',text:'a',text_complete:true},{kind:'text',item_identity:'b',text:'b',text_complete:true}],provenance:{message:{reply_to:'prior',expect_reply:false}}}))}};});
 const out=lease.state.peek();expect(reads).toBe(2);expect(out.phase).toBe('settled');if(out.phase!=='settled'||!out.result.ok)throw new Error('Expected rich selected cut');expect(out.result.value.items.at(-1)?.provenance?.message).toMatchObject({reply_to:'prior'});
});


it('join rejects selected cuts above the existing 1600-row bound with input-bound',()=>{
 const page={thread_id:'t',revision:2,total:1600,items:Array.from({length:200},(_,i)=>({node_id:`n${i}`,kind:'event',selection:{ordinal:i},items:[]}))};
 const pages=Array.from({length:8},()=>HistoryWindowInput.own(page));
 let error:unknown;try{HistoryWindowInput.join([...pages,HistoryWindowInput.own({...page,items:[{...page.items[0]!,node_id:'extra',selection:{ordinal:1600}}]})]);}catch(value){error=value;}expect((error as {reason?:string}).reason).toBe('input-bound');
});

it.each(['gap','revision','total','cancel','budget'] as const)('paged selected %s never exposes a partially assembled cut',async mode=>{
 const slots=new TerminalReadSlots(),parent=new Cancel();let current=true,reads=0,budget=mode==='budget'?0:8;
 const selected={...request,args:{thread_id:'t',ordinal:100,before:0,after:199,items:true},selection:{first:100,last:500,revision:2}};
 const lease=slots.request({kind:'persisted',receipt},selected,()=>current,parent);
 if(!('state' in lease))throw new Error('Expected actual paged lease');
 const settled:number[]=[];const stop=lease.state.subscribe(state=>{if(state.phase==='settled'&&state.result.ok)settled.push(state.result.value.items.length);});
 await slots.dispatch(()=>budget>0&&(budget--,true),async args=>{
  reads++;const first=args.ordinal??-1,n=(args.after??0)+1;
  if(reads===2&&mode==='cancel'){current=false;parent.cancel();}
  const items=Array.from({length:n},(_,index)=>({node_id:`node-${first+index}`,selection:{ordinal:first+index},kind:'event',items:[]}));
  if(reads===2&&mode==='gap')items.splice(1,1);
  return{ok:true,value:{thread_id:'t',revision:reads===2&&mode==='revision'?3:2,total:reads===2&&mode==='total'?1001:1000,items}};
 });
 expect(settled).toEqual([]);expect(lease.state.peek()).toMatchObject({phase:'unavailable',reason:mode==='cancel'?'cancelled':mode==='budget'?'budget-exhausted':'selection-gap'});
 expect(reads).toBe(mode==='budget'?0:2);stop();
});
