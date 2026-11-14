import {controlledWindow} from './controlled-window';
import { captureConversationInput } from '../src/conversation-input';
import { expect, it } from "vitest";
import { ConversationWindow } from "../src/window";
import { flush } from "../../data/test/harness";
import type { HistoryItem } from "../../data/src";
import { rig } from "./window-owner";
import { observeDeclaredCuts, type DeclaredPlanCut } from "./publication-contract";

it("publishes immutable coherent window tuples and stops obsolete notifications", async () => {
  const r = await rig(10,{decorate:(ordinal,node)=>({...node,kind:'user',items:[{kind:'text',item_identity:'body',text:`Declared ${ordinal}`,text_complete:true}],provenance:{sender:{kind:'human'}}})}); await r.settle();
  const cut=(revision:1|2,count:number):DeclaredPlanCut=>{const ids=Array.from({length:count},(_,i)=>`n0-${i}`);
   return{scope:'history',revision,coverage:'complete',rows:ids,entries:ids.map((id,i)=>({key:JSON.stringify([id,'body']),case:'human',
    source:{nodeId:id,itemIdentity:'body',windowRevision:revision,keyScope:['history'],classificationCase:'human',kind:'user',text:`Declared ${i}`,textComplete:true},
    body:{kind:'typed-canonical',text:`Declared ${i}`},lifetime:'canonical-human'})),
    sequence:ids.map(id=>({kind:'conversation',itemKey:JSON.stringify([id,'body'])})),groups:[]};};
  const authorized=[cut(1,10),cut(2,10),cut(2,11)];
  const publications = observeDeclaredCuts(r.w,()=>authorized);
  const first = r.w.acceptedView.peek();
  expect(first.total).toBe(10); expect(first.pending).toBe(false); expect(first.range).toEqual(r.w.renderRange());
  expect(first.rows).toEqual(r.w.rangeItems()); expect(Object.isFrozen(first.rows[0])).toBe(true);
  let nested = false; const seen: number[] = [];
  r.w.acceptedView.subscribe(() => { if (!nested) { nested = true; r.w.layoutChanged(); } });
  r.w.acceptedView.subscribe(ref => { expect(ref).toBe(r.w.acceptedView.peek()); seen.push(ref.generation); });
  r.w.layoutChanged(); expect(seen).toHaveLength(0);expect(r.w.acceptedView.peek()).toBe(first);
  r.owner.append(1);r.w.view(0,10_000,true);r.w.changed();await r.settle();expect(seen).toHaveLength(4);expect(seen.at(-1)).toBe(r.w.acceptedView.peek().generation);
  expect(first.rows).toHaveLength(10); expect(publications.generations.length).toBeGreaterThan(0); publications.stop(); r.w.dispose(); expect(r.w.acceptedView.isCurrent(first)).toBe(false); r.data.stop();
});
it("scroll peek is non-consuming and only an unchanged current view consumes once without publication", async () => {
  const r = await rig(10); await r.settle();
  const original = r.w.acceptedView.peek(), request = r.w.peekScroll(original);
  expect(request).toBeDefined(); expect(r.w.peekScroll(original)).toBe(request);
  r.w.layoutChanged(); const next = r.w.acceptedView.peek();
  expect(next).toBe(original);
  expect(r.w.peekScroll(next)).toBe(request);
  expect(r.w.consumeScroll(next, request!.id)).toBe(true);
  expect(r.w.acceptedView.peek()).toBe(next); expect(r.w.acceptedView.isCurrent(next)).toBe(true);
  expect(r.w.consumeScroll(next, request!.id)).toBe(false); r.w.dispose(); r.data.stop();
});
it("disposal revokes publication and request eligibility before cancellation callbacks", async () => {
  const r = await rig(10); await r.settle(); const ref = r.w.acceptedView.peek();
  const plan = r.w.peekScroll(ref); r.w.dispose();
  expect(r.w.acceptedView.isCurrent(ref)).toBe(false); expect(r.w.peekScroll(ref)).toBeUndefined();
  expect(r.w.consumeScroll(ref, plan!.id)).toBe(false); r.data.stop();
});

it("tail response publishes rows/range/total/revision coherently without treating pending as follow intent", async () => {
  const r = await rig(10); await r.settle();
  const before = r.w.acceptedView.peek();
  const seen: number[] = [];
  const stop = r.w.acceptedView.subscribe(ref => {
    expect(ref).toBe(r.w.acceptedView.peek());
    expect(ref.total).toBe(r.w.total);
    expect(ref.range).toEqual(r.w.renderRange());
    expect(ref.rows).toEqual(r.w.rangeItems());
    expect(ref.rows.every(row => row.selection!.ordinal! < ref.total)).toBe(true);
    expect(ref.revision).toBe(2); seen.push(ref.generation);
  });
  r.owner.append(2); r.w.changed();
  expect(r.w.following.peek()).toBe(true);
  r.w.following.value = false;
  expect(r.w.following.peek()).toBe(false);
  expect(r.w.acceptedView.peek()).toBe(before);
  await r.settle(); expect(seen.length).toBeGreaterThan(0);
  expect(r.w.acceptedView.peek().total).toBe(12);
  expect(r.w.following.peek()).toBe(false);
  stop(); r.w.dispose(); r.data.stop();
});

it("getter reentry during actual Window staging cannot overwrite a nested accepted generation", async () => {
  const row: HistoryItem = { node_id: "plain-local", kind: "user", excerpt: "local", selection: { ordinal: 0 } };
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "t", total: 1, revision: 1, items: [row] } }) });
  await flush(); let nested = false;
  Object.defineProperty(row, "syntheticGetter", { configurable: true, enumerable: true, get() {
    if (!nested) { nested = true; w.setAttemptPresentations([{scope:'history',attemptId:'newer',turnId:'turn',nodeIds:['plain-local'],state:'pending'}]); }
    return "materialized";
  } });
  const seen: number[] = [];
  const stop = w.acceptedView.subscribe(ref => seen.push(ref.generation));
  w.setAttemptPresentations([{scope:'history',attemptId:'older',turnId:'turn',nodeIds:['plain-local'],state:'pending'}]);
  expect(nested).toBe(true); expect(seen).toHaveLength(1);
  expect(seen[0]).toBe(w.acceptedView.peek().generation);
  stop(); w.dispose();
});

it("pending latest-tail evidence preserves existing follow but cannot recreate detached intent", async () => {
  const r=controlledWindow(),w=r.win;
  const rows=(first:number,last:number):HistoryItem[]=>Array.from({length:last-first+1},(_,offset)=>{
    const ordinal=first+offset;return{node_id:`n${ordinal}`,kind:'user',selection:{ordinal},
      items:[{kind:'text',item_identity:'body',text:`Saved ${ordinal}`,text_complete:true}],provenance:{sender:{kind:'human'}}};
  });
  try{
    expect(r.requests[0]!.args).toMatchObject({before:99,after:0,items:true});
    r.requests[0]!.reply({ok:true,value:{thread_id:'t',revision:1,total:100,items:rows(0,99)}});await flush();
    const before=w.acceptedView.peek();expect(before.rows.map(row=>row.node_id)).toEqual(rows(0,99).map(row=>row.node_id));
    w.changed();const tail=r.pending()[0]!;expect(tail.args).toMatchObject({ordinal:99,expect_node_id:'n99',before:0,after:199});
    tail.reply({ok:true,value:{thread_id:'t',revision:2,total:1100,items:rows(99,298)}});await flush();
    const verification=r.pending();expect(verification).toHaveLength(1);
    expect(verification[0]!.args).toMatchObject({ordinal:99,expect_node_id:'n99',before:0,after:0});
    expect(w.acceptedView.peek()).toBe(before);expect(w.following.peek()).toBe(true);
    w.view(0,600,true);expect(w.following.peek()).toBe(true);
    w.view(0,600,false);expect(w.following.peek()).toBe(false);
    w.view(0,600,true);expect(w.following.peek()).toBe(false);
    expect(w.acceptedView.peek()).toBe(before);expect(r.pending()).toHaveLength(1);
    verification[0]!.reply({ok:true,value:{thread_id:'t',revision:2,total:1100,items:rows(99,99)}});await flush();
    expect(w.following.peek()).toBe(false);expect(w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(rows(0,99).map(row=>row.node_id));
    w.jumpToEnd();expect(w.following.peek()).toBe(true);
    expect(w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(rows(0,99).map(row=>row.node_id));
  }finally{w.dispose();expect(r.pending()).toHaveLength(0);}
});

it("requests authoritative saved items, preserves whole deferred nodes and retries their first ordinal", async () => {
  const r = await rig(3);
  r.owner.decorate = (ordinal, row) => ({ ...row, kind: "assistant_response", items: ordinal >= 1 ? null : [{ kind: "text", item_identity: `item${ordinal}`, text: "saved authoritative text", text_complete: true }], ...(ordinal >= 1 ? { items_unavailable_reason: "response_budget" as const } : {}) });
  await r.settle();
  const ref = r.w.acceptedView.peek();
  expect(ref.rows).toHaveLength(3);
  expect(ref.rows[0]!.items?.[0]).toMatchObject({ text: "saved authoritative text" });
  expect(ref.rows[1]!.items).toBeNull(); expect(ref.rows[1]!.node_id).toBeTruthy();
  expect(r.t.calls("history.window").every(call => (call.args as { items?: boolean }).items === true)).toBe(true);
  expect(r.t.calls("thread.work.status")).toHaveLength(0);
  expect(r.w.retryDeferred(ref)).toBe(true);
  const retry = r.t.calls("history.window").at(-1)!;
  expect(retry.args).toMatchObject({ ordinal: 1, expect_node_id: ref.rows[1]!.node_id, items: true });
  expect(r.w.retryDeferred(ref)).toBe(false);
  r.w.acceptedView.revoke(); expect(r.w.retryDeferred(ref)).toBe(false);
  r.w.dispose(); r.data.stop();
});

it("deferred retry shares two distinct bucket slots and waits for the separately held tail", async () => {
  const r=controlledWindow(),w=r.win;
  const rows=(first:number,last:number):HistoryItem[]=>Array.from({length:last-first+1},(_,offset)=>{
    const ordinal=first+offset;return{node_id:ordinal===800?'deferred':`n${ordinal}`,kind:'user',selection:{ordinal},
      ...(ordinal>=800?{items:null,items_unavailable_reason:'response_budget' as const}:
        {items:[{kind:'text' as const,item_identity:'body',text:`Saved ${ordinal}`,text_complete:true}]})};
  });
  try{
    r.requests[0]!.reply({ok:true,value:{thread_id:'t',total:750,revision:1,items:rows(650,749)}});await flush();
    w.changed();r.pending()[0]!.reply({ok:true,value:{thread_id:'t',total:1000,revision:2,items:rows(749,948)}});await flush();
    const verify=r.pending()[0]!;expect(verify.args).toMatchObject({ordinal:749,before:0,after:0});
    verify.reply({ok:true,value:{thread_id:'t',total:1000,revision:2,items:rows(749,749)}});await flush();
    const forward=r.pending()[0]!;expect(forward.args).toMatchObject({ordinal:749,before:0,after:199});
    w.view(0,600,false);
    forward.reply({ok:true,value:{thread_id:'t',total:1000,revision:2,items:rows(749,948)}});await flush();
    const tail=r.pending()[0]!;expect(tail.args).toMatchObject({before:99,after:0});
    expect(w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(rows(650,948).map(row=>row.node_id));
    w.view(Math.max(0,w.totalHeight()-600),600,false);r.viewportPause();
    const first=r.pending().find(request=>request.args.ordinal===600)!;
    const second=r.pending().find(request=>request.args.ordinal===900)!;
    expect(first).toBeDefined();expect(second,JSON.stringify({pending:r.pending().map(request=>request.args),total:w.total,range:w.renderRange(),height:w.totalHeight(),scroll:w.scrollTop})).toBeDefined();expect(r.pending()).toHaveLength(3);expect(w.readsInFlight).toBe(3);
    const before=w.acceptedView.peek(),count=r.requests.length;
    expect(w.retryDeferred(before)).toBe(false);expect(r.requests).toHaveLength(count);expect(w.acceptedView.peek()).toBe(before);
    tail.reply({ok:true,value:{thread_id:'t',total:1000,revision:2,items:rows(900,999)}});await flush();
    expect(w.readsInFlight).toBe(2);expect(w.retryDeferred(w.acceptedView.peek())).toBe(false);expect(r.requests).toHaveLength(count);
    first.reply({ok:true,value:{thread_id:'t',total:1000,revision:2,items:rows(600,699)}});await flush();
    expect(w.readsInFlight).toBe(1);expect(w.retryDeferred(w.acceptedView.peek())).toBe(true);
    expect(r.requests).toHaveLength(count+1);expect(r.pending()).toHaveLength(2);
    expect(r.requests.at(-1)!.args).toMatchObject({ordinal:800,expect_node_id:'deferred',before:0,after:99,items:true});
    expect(w.retryDeferred(w.acceptedView.peek())).toBe(false);expect(r.requests).toHaveLength(count+1);
    expect(w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(rows(600,999).map(row=>row.node_id));
  }finally{w.dispose();expect(r.pending()).toHaveLength(0);}
});

it("publishes one capability-bound display plan and reaches a fixed point", async () => {
  const r = await rig(2); await r.settle();
  expect(r.w.bindConversationInput(snapshot => captureConversationInput(snapshot, {
    scope: 'thread', threadId: 'thread', records: [], work: [], current: true }))).toBe(true);
  const ref = r.w.acceptedView.peek();
  expect(r.w.refreshConversationInput(ref)).toBe(true);
  const published = r.w.acceptedView.peek();
  expect(published.displayPlan?.acceptedGeneration).toBe(published.generation);
  expect(published.displayPlan?.capability).toBe(r.w.acceptedView.currentCapability);
  const generation = published.generation;
  expect(r.w.refreshConversationInput(published)).toBe(true);
  expect(r.w.acceptedView.peek().generation).toBe(generation);
  r.w.layoutChanged();
  expect(r.w.acceptedView.peek()).toBe(published);
  expect(r.w.refreshConversationInput(published)).toBe(true);
  expect(r.w.acceptedView.peek().generation).toBe(generation);
  expect(r.w.refreshConversationInput(ref)).toBe(false);
  r.w.dispose(); r.data.stop();
});
