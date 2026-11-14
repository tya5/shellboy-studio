import { Handoff, type AttemptReadyProof } from "../src/handoff";
import { expect, it } from "vitest";
import { TerminalReadSlots, type SelectedCanonicalRequest, type OwnedTerminalReadLease } from "../src/terminal-read";
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
