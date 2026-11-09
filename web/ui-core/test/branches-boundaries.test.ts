import { effect } from "@preact/signals-core";
import { expect, it } from "vitest";
import { Link } from "../../data/src/link";
import { Operations } from "../../data/src/operations";
import { FakeTransport, flush } from "../../data/test/harness";
import { Branches, ExcerptBatch } from "../src/branching";
const transitions = ["B", "ABA", "unavailable", "leave", "thread", "target", "same"] as const;
type Transition = typeof transitions[number];
function fixture() {
  const t = new FakeTransport(), link = new Link(t); link.start(); t.open(); let owner: string | undefined = "a", n = 0;
  const ops = new Operations(link, () => `${owner}:${++n}`);
  const b = new Branches(ops, () => owner);
  const target = { threadId: "parent", nodeId: "point" }; b.target.value = target; b.ownerChanged(owner);
  b.state.value = { ...b.state.peek(), threadId: "parent" };
  const change = (o: string | undefined) => { owner = o; b.ownerChanged(o); };
  const invalidate = (kind: Transition) => {
    if (kind === "B") change("b");
    if (kind === "ABA") { change("b"); change("a"); }
    if (kind === "unavailable") { change(undefined); change("a"); }
    if (kind === "leave") b.leave();
    if (kind === "thread") b.state.value = { ...b.state.peek(), threadId: "other" };
    if (kind === "target") b.target.value = { ...target, nodeId: "other" };
  };
  return { t, link, ops, b, target, invalidate };
}
const child = { thread_id: "child", title: "child" };
const boundaries = ["forking", "failed", "done", "partial-error", "success-clear", "send-clear", "fork-await", "send-await"] as const;
for (const boundary of boundaries) for (const transition of transitions) it(`R1 fork ${boundary} x ${transition}`, async () => {
  const f = fixture(); f.b.actionError.value = "prior"; let triggered = false, armed = false;
  const fire = () => { if (triggered || !armed) return; triggered = true; f.invalidate(transition); };
  const stop = effect(() => {
    const fork = f.b.fork.value, error = f.b.actionError.value;
    if ((boundary === "forking" && fork.kind === "forking") || (boundary === "failed" && fork.kind === "failed") ||
      (boundary === "done" && fork.kind === "done") || (boundary === "partial-error" && error?.startsWith("Branch child created")) ||
      ((boundary === "success-clear" || boundary === "send-clear") && error === undefined)) fire();
  });
  armed = true;
  const text = boundary === "partial-error" || boundary === "send-await" || boundary === "send-clear" ? "fixed" : "";
  const p = f.b.forkAt(f.target, text);
  if (boundary === "forking" && transition !== "same") {
    expect(f.t.calls("thread.fork")).toHaveLength(0);
  } else {
    const fork = f.t.calls("thread.fork")[0]!;
    expect(fork.args).toEqual({ thread_id: "parent", node_id: "point" }); expect(fork.operation_id).toBeTruthy();
    if (boundary === "fork-await") fire();
    if (boundary === "failed") f.t.ownerError(fork.id, "operation_expired"); else f.t.ok(fork.id, child);
    await flush();
    if (text) {
      const send = f.t.calls("message.send")[0]!;
      expect(send.args).toEqual({ thread_id: "child", text: "fixed" });
      if (boundary === "send-await") fire();
      if (boundary === "partial-error") f.t.ownerError(send.id, "thread_busy"); else f.t.ok(send.id, {});
    }
  }
  await p;
  if (transition !== "same") {
    expect(f.t.calls("thread.branches")).toHaveLength(0);
    if (boundary === "fork-await") expect(f.t.calls("message.send")).toHaveLength(0);
    if (boundary === "partial-error") expect(f.b.fork.value.kind).not.toBe("done");
  } else if (boundary === "done" || boundary === "fork-await" || boundary === "send-await" || boundary === "success-clear" || boundary === "send-clear" || boundary === "forking") {
    expect(f.t.calls("thread.branches")).toHaveLength(1);
  }
  stop(); f.b.leave(); f.link.stop();
});

for (const transition of transitions.filter(t => t !== "target")) it(`R1 loading publish x ${transition}`, async () => {
  const f = fixture(); let fired = false;
  const stop = effect(() => { if (f.b.state.value.loading && !fired) { fired = true; f.invalidate(transition); } });
  const p = f.b.read("parent");
  if (transition === "same") {
    f.t.ok(f.t.calls("thread.branches")[0]!.id, { root_thread_id: "parent", items: [], total: 0 });
  } else expect(f.t.calls("thread.branches")).toHaveLength(0);
  await p; stop(); f.b.leave(); f.link.stop();
});

it("R1 show invalidation consumes no new row admission", async () => {
  let reads = 0, initial = true;
  const batch = new ExcerptBatch(async () => { reads++; return {}; });
  batch.show({ threadId: "x" } as Parameters<Branches["excerpts"]>[0], () => { if (initial) { initial = false; batch.reset(); } });
  await flush(); expect(reads).toBe(0);
});
it("R1 release callback replacement of the same Thread keeps its new row", async () => {
  const pending: (() => void)[] = []; let reads = 0, replace = false;
  const batch = new ExcerptBatch(async () => { reads++; await new Promise<void>(r => pending.push(r)); return {}; });
  const item = { threadId: "x" } as Parameters<Branches["excerpts"]>[0];
  const release = batch.show(item, () => { if (replace) { replace = false; batch.reset(); batch.show(item, () => {}); } });
  replace = true; release(); pending.shift()!(); await flush(); expect(reads).toBe(2);
  pending.shift()!(); await flush(); batch.reset();
});

const mutationSites = ["rename-error", "archive-selection", "archive-error", "rewinding", "rewind-failed", "rewind-done", "rewind-error", "previewing", "preview-await"] as const;
for (const site of mutationSites) for (const transition of transitions) it(`R1 B12 ${site} x ${transition}`, async () => {
  const f = fixture(); let armed = false, fired = false;
  // Rename/archive are Thread actions: target-only change is irrelevant.
  const invalid = transition !== "same" && !(transition === "target" && (site.startsWith("rename") || site.startsWith("archive")));
  f.b.actionError.value = "old error";
  const stop = effect(() => {
    const error = f.b.actionError.value, selection = f.b.selection.value, rewind = f.b.rewind.value;
    if (!armed || fired) return;
    const hit = site === "rename-error" ? error === undefined : site === "archive-selection" ? selection.size === 0 :
      site === "archive-error" ? error === undefined : site === "rewinding" ? rewind.kind === "rewinding" :
      site === "rewind-failed" ? rewind.kind === "failed" : site === "rewind-done" ? rewind.kind === "done" :
      site === "rewind-error" ? error?.startsWith("Rewind succeeded;") : site === "previewing" ? rewind.kind === "previewing" : false;
    if (hit) { fired = true; f.invalidate(transition); }
  });
  let p: Promise<void>;
  if (site.startsWith("rename")) {
    armed = true; p = f.b.renameBranch("parent", "fixed"); f.t.ok(f.t.calls("thread.set")[0]!.id, { thread_id: "parent", title: "fixed" });
  } else if (site.startsWith("archive")) {
    f.b.toggleBranch("parent"); armed = true; p = f.b.archiveSelected();
    f.t.ok(f.t.calls("thread.archive")[0]!.id, { archived: ["parent"], not_found: [] });
  } else if (site.startsWith("preview")) {
    armed = true; p = f.b.previewRewind(f.target);
    if (site === "preview-await") { f.invalidate(transition); }
    const call = f.t.calls("thread.rewind")[0]; if (call) f.t.ok(call.id, { removed_node_count: 1 });
  } else {
    const preview = f.b.previewRewind(f.target); f.t.ok(f.t.calls("thread.rewind")[0]!.id, { removed_node_count: 1 }); await preview;
    armed = true; p = f.b.confirmRewind(site === "rewind-error" ? "fixed" : "");
    const call = f.t.calls("thread.rewind")[1];
    if (call) {
      if (site === "rewind-failed") f.t.ownerError(call.id, "operation_expired"); else f.t.ok(call.id, { removed_node_count: 1 });
      await flush();
      if (site === "rewind-error") f.t.ownerError(f.t.calls("message.send")[0]!.id, "thread_busy");
    }
  }
  await p;
  if (invalid) {
    expect(f.t.calls("thread.branches")).toHaveLength(0);
    if (site === "rewinding" || site === "previewing") expect(f.t.calls("thread.rewind")).toHaveLength(site === "rewinding" ? 1 : 0);
    if (site === "preview-await") expect(f.b.rewind.value.kind).not.toBe("ready");
  } else if (site === "rename-error" || site.startsWith("archive") || site === "rewind-done" || site === "rewind-error" || site === "rewinding") {
    expect(f.t.calls("thread.branches")).toHaveLength(1);
  }
  stop(); f.b.leave(); f.link.stop();
});

it("R1 fresh mismatched target neither mints a receipt nor occupies the fork slot", async () => {
  const f = fixture(); f.b.target.value = { ...f.target, nodeId: "different" };
  await f.b.forkAt(f.target, "wrong"); expect(f.t.calls("thread.fork")).toHaveLength(0);
  f.b.target.value = f.target; const p = f.b.forkAt(f.target, "valid");
  expect(f.t.calls("thread.fork")[0]!.operation_id).toBe("a:1"); f.t.drop(); await p; f.link.stop();
});

for (const site of ["fork-await", "send-await", "cached"] as const) for (const transition of transitions) it(`R1 retained fork ${site} x ${transition}`, async () => {
  const f = fixture(); const p = f.b.forkAt(f.target, "fixed"); const fork = f.t.calls("thread.fork")[0]!;
  if (site !== "fork-await") { f.t.ok(fork.id, child); await flush(); }
  if (site === "cached") { f.t.ok(f.t.calls("message.send")[0]!.id, {}); await p; }
  else { f.t.drop(); await p; f.t.open(); }
  const calls = f.t.calls().length; f.invalidate(transition);
  const retry = f.b.forkAt(f.target, "fixed"); await flush();
  if (transition === "B") {
    const lookup = f.t.calls("operation.get").at(-1)!;
    f.t.ok(lookup.id, { operation_id: fork.operation_id, state: "completed", replay_policy: "return_saved_outcome", outcome: { result: child } });
  } else if (transition === "target") {
    expect(f.t.calls().length).toBe(calls);
  } else if (site === "fork-await") {
    const same = f.t.calls("thread.fork")[1]!; expect(same.operation_id).toBe(fork.operation_id); expect(same.args).toEqual(fork.args);
    f.t.drop();
  } else if (site === "send-await") {
    const send = f.t.calls("message.send")[1]!; expect(send.operation_id).toBe(f.t.calls("message.send")[0]!.operation_id); expect(send.args).toEqual({thread_id:"child",text:"fixed"});f.t.drop();
  }
  await retry;
  if (transition === "B" || transition === "target") expect(f.t.calls("thread.fork")).toHaveLength(1);
  if (site !== "fork-await") expect(f.t.calls("thread.fork")).toHaveLength(1);
  f.b.leave(); f.link.stop();
});
for (const phase of ["result", "error"] as const) for (const transition of transitions.filter(t=>t!=="target")) it(`R1 family ${phase} publish x ${transition}`, async()=>{
  const f=fixture();let fired=false;const stop=effect(()=>{const s=f.b.state.value;if(!fired&&(phase==="result"?!!s.family:!!s.error)){fired=true;f.invalidate(transition);}});
  const p=f.b.read("parent");const call=f.t.calls("thread.branches")[0]!;
  if(phase==="result")f.t.ok(call.id,{root_thread_id:"parent",items:[],total:0});else f.t.ownerError(call.id,"thread_not_found");
  await p;expect(f.t.calls("thread.branches")).toHaveLength(1);stop();f.b.leave();f.link.stop();
});
it("R1 loading read reentry admits one walk without reviving the outer call",async()=>{
  const f=fixture();let fired=false;let trailing:Promise<void>|undefined;
  const stop=effect(()=>{if(f.b.state.value.loading&&!fired){fired=true;trailing=f.b.read("parent");}});
  const p=f.b.read("parent");expect(f.t.calls("thread.branches")).toHaveLength(1);
  f.t.ok(f.t.calls("thread.branches")[0]!.id,{root_thread_id:"parent",items:[],total:0});await p;await trailing;
  expect(f.t.calls("thread.branches")).toHaveLength(1);stop();f.b.leave();f.link.stop();
});

for (const action of ["rename", "archive", "rewind", "rewind-send", "preview"] as const) for (const transition of transitions) it(`R1 await ${action} x ${transition}`, async()=>{
  const f=fixture();let p:Promise<void>,call;
  if(action==="rename"){p=f.b.renameBranch("parent","fixed");call=f.t.calls("thread.set")[0]!;}
  else if(action==="archive"){f.b.toggleBranch("parent");p=f.b.archiveSelected();call=f.t.calls("thread.archive")[0]!;}
  else if(action==="preview"){p=f.b.previewRewind(f.target);call=f.t.calls("thread.rewind")[0]!;}
  else {
    const preview=f.b.previewRewind(f.target);f.t.ok(f.t.calls("thread.rewind")[0]!.id,{removed_node_count:1});await preview;
    p=f.b.confirmRewind(action==="rewind-send"?"fixed":"");call=f.t.calls("thread.rewind")[1]!;
    if(action==="rewind-send"){f.t.ok(call.id,{removed_node_count:1});await flush();call=f.t.calls("message.send")[0]!;}
  }
  const id=call.operation_id,args=call.args;f.invalidate(transition);const state=f.b.state.peek();
  const isCurrent=transition==="same"||(transition==="target"&&(action==="rename"||action==="archive"));
  f.b.actionError.value="new projection";
  f.t.ok(call.id,action==="rename"?{thread_id:"parent",title:"fixed"}:action==="archive"?{archived:["parent"],not_found:[]}:action==="rewind-send"?{}:{removed_node_count:1});await p;
  expect(call.operation_id).toBe(id);expect(call.args).toEqual(args);
  if(!isCurrent){expect(f.t.calls("thread.branches")).toHaveLength(0);expect(f.b.state.peek()).toBe(state);expect(f.b.actionError.value).toBe("new projection");}
  f.b.leave();f.link.stop();
});
for (const point of ["reset", "facts"] as const) for (const transition of transitions) it(`R1 excerpt ${point} x ${transition}`, async()=>{
  let invalidated=false,armed=false,reads=0,finish!:(value:{answer:string})=>void;
  const item={threadId:"x"} as Parameters<Branches["excerpts"]>[0];
  const batch=new ExcerptBatch(async()=>{reads++;return new Promise<{answer:string}>(r=>{finish=r;});});
  const facts: string[]=[];
  const release=batch.show(item,value=>{if(value.answer)facts.push(value.answer);if(armed&&!invalidated){invalidated=true;if(transition!=="same")batch.reset();}});
  armed=true;if(point==="reset")batch.reset();else finish({answer:"saved"});await flush();
  if(point==="reset"){finish({answer:"late"});await flush();expect(facts).toEqual([]);}else expect(facts).toEqual(["saved"]);
  expect(reads).toBe(1);release();batch.reset();
});
it("R1 leave reset callback new read owns its loading state",async()=>{
  const f=fixture();let armed=false;let fresh:Promise<void>|undefined;
  f.b.excerptBatch.show({threadId:"x"} as Parameters<Branches["excerpts"]>[0],()=>{if(armed){armed=false;fresh=f.b.read("other");}});
  armed=true;f.b.leave();expect(f.b.state.peek().loading).toBe(true);expect(f.b.state.peek().threadId).toBe("other");
  f.t.ok(f.t.calls("thread.branches")[0]!.id,{root_thread_id:"other",items:[],total:0});await fresh;expect(f.b.state.peek().family?.rootId).toBe("other");f.b.leave();f.link.stop();
});
for (const transition of transitions) it(`R1 excerpt initial admission x ${transition}`, async()=>{
  let reads=0,first=true;const batch=new ExcerptBatch(async()=>{reads++;return {};});
  batch.show({threadId:"x"} as Parameters<Branches["excerpts"]>[0],()=>{if(first){first=false;if(transition!=="same")batch.reset();}});
  await flush();expect(reads).toBe(transition==="same"?1:0);batch.reset();
});
it("R1 pending and cached fork retarget never dispatch; a valid new explicit action has its own ID",async()=>{
  const f=fixture();const p=f.b.forkAt(f.target);const original=f.t.calls("thread.fork")[0]!;
  f.b.target.value={...f.target,nodeId:"other"};await f.b.forkAt(f.target);expect(f.t.calls("thread.fork")).toHaveLength(1);
  f.t.ok(original.id,child);await p;await f.b.forkAt(f.target);expect(f.t.calls("thread.fork")).toHaveLength(1);
  const next={threadId:"parent",nodeId:"other"};const fresh=f.b.forkAt(next);const second=f.t.calls("thread.fork")[1]!;
  expect(second.operation_id).not.toBe(original.operation_id);expect(second.args).toEqual({thread_id:"parent",node_id:"other"});f.t.drop();await fresh;f.link.stop();
});

it("R1 old-owner changed stale payload cannot replace the slot or mint a fresh receipt",async()=>{
  const f=fixture();const first=f.b.forkAt(f.target);const original=f.t.calls("thread.fork")[0]!;
  f.t.ok(original.id,child);await first;f.invalidate("B");const current={...f.target,nodeId:"new"};f.b.target.value=current;
  await f.b.forkAt(f.target,"stale changed");expect(f.t.calls("thread.fork")).toHaveLength(1);
  const fresh=f.b.forkAt(current,"valid");const call=f.t.calls("thread.fork")[1]!;
  expect(call.operation_id).toBe("b:2");expect(call.args).toEqual({thread_id:"parent",node_id:"new"});
  f.t.drop();await fresh;f.link.stop();
});
for(const trigger of ["restart", "clear", "leave", "select"] as const) it(`R1 preview ${trigger} cancel callback cannot overwrite a newer explicit preview`,async()=>{
  const f=fixture();const original=f.ops.threadRewindPreview.bind(f.ops);let nested:Promise<void>|undefined,hooked=false;
  f.ops.threadRewindPreview=(args,read)=>{
    if(!hooked){hooked=true;read?.cancel?.add(()=>{nested=f.b.previewRewind(f.b.target.peek()!);});}
    return original(args,read);
  };
  const initial=f.b.previewRewind(f.target);
  let restart:Promise<void>|undefined;
  if(trigger==="restart")restart=f.b.previewRewind(f.target);
  else if(trigger==="leave")f.b.leave();
  else if(trigger==="select")f.b.select("parent","new-point");
  else f.b.clearActions();
  expect(f.t.calls("thread.rewind")).toHaveLength(2);expect(f.b.rewind.value.kind).toBe("previewing");
  f.t.ok(f.t.calls("thread.rewind")[1]!.id,{removed_node_count:2});await nested;await initial;await restart;
  expect(f.b.rewind.value.kind).toBe("ready");expect(f.t.calls("thread.rewind")).toHaveLength(2);f.b.leave();f.link.stop();
});

for(const nested of [false,true]) it(`R1 owner invalidation cancels captured handles only, nested preview ${nested}`,async()=>{
  const f=fixture();const original=f.ops.threadBranches.bind(f.ops),preview=f.ops.threadRewindPreview.bind(f.ops);
  let winner:Promise<void>|undefined,winnerCancelled=false,calls=0;
  f.ops.threadBranches=(args,read)=>{if(nested)read?.cancel?.add(()=>{winner=f.b.previewRewind(f.target);});return original(args,read);};
  f.ops.threadRewindPreview=(args,read)=>{calls++;if(calls>1)read?.cancel?.add(()=>{winnerCancelled=true;});return preview(args,read);};
  const initial=f.b.previewRewind(f.target);const reading=f.b.read("parent");
  f.invalidate("B");await initial;await reading;
  expect(f.b.state.peek().loading).toBe(false);
  if(nested){expect(winnerCancelled).toBe(false);f.t.ok(f.t.calls("thread.rewind")[1]!.id,{removed_node_count:2});await winner;expect(f.b.rewind.value.kind).toBe("ready");}
  else expect(f.t.calls("thread.rewind")).toHaveLength(1);
  f.b.leave();f.link.stop();
});
it("R1 owner invalidation preview cancellation cannot cancel an explicit new family reader",async()=>{
  const f=fixture();const preview=f.ops.threadRewindPreview.bind(f.ops),family=f.ops.threadBranches.bind(f.ops);
  let winner:Promise<void>|undefined,newCancelled=false,walks=0;
  f.ops.threadRewindPreview=(args,read)=>{read?.cancel?.add(()=>{winner=f.b.read("other");});return preview(args,read);};
  f.ops.threadBranches=(args,read)=>{walks++;if(walks>1)read?.cancel?.add(()=>{newCancelled=true;});return family(args,read);};
  const initial=f.b.previewRewind(f.target),old=f.b.read("parent");f.invalidate("B");await initial;await flush();
  expect(newCancelled).toBe(false);expect(f.t.calls("thread.branches")).toHaveLength(2);
  f.t.ok(f.t.calls("thread.branches")[1]!.id,{root_thread_id:"other",items:[],total:0});await winner;await old;await flush();
  expect(f.b.state.peek().family?.rootId).toBe("other");f.b.leave();f.link.stop();
});

it("R1 owner invalidation detaches old excerpts even when family cancellation starts a new preview",async()=>{
  const f=fixture();const family=f.ops.threadBranches.bind(f.ops),window=f.ops.historyWindow.bind(f.ops);
  let ready:Promise<void>|undefined,cancelled=false;
  f.ops.threadBranches=(args,read)=>{read?.cancel?.add(()=>{ready=f.b.previewRewind(f.target);});return family(args,read);};
  f.ops.historyWindow=(args,read)=>{if(args.thread_id==="second")read?.cancel?.add(()=>{cancelled=true;});return window(args,read);};
  const seen:string[]=[];f.b.excerptBatch.show({threadId:"child",tipNodeId:"tip"} as Parameters<Branches["excerpts"]>[0],v=>{if(v.answer)seen.push(v.answer);});
  const oldWindow=f.t.calls("history.window")[0]!;const p=f.b.read("parent");
  // A read resets prior excerpts; install another pending row in that read epoch.
  f.b.excerptBatch.show({threadId:"second",tipNodeId:"tip"} as Parameters<Branches["excerpts"]>[0],v=>{if(v.answer)seen.push(v.answer);});
  await flush();f.invalidate("B");await p;expect(cancelled).toBe(true);
  for(const call of f.t.calls("history.window"))f.t.ok(call.id,{thread_id:"child",revision:1,total:1,items:[{node_id:"tip",kind:"assistant_response",excerpt:"stale",selection:{ordinal:1}}]});
  await flush();expect(seen).toEqual([]);expect(oldWindow.id).toBeTruthy();
  f.t.ok(f.t.calls("thread.rewind")[0]!.id,{removed_node_count:1});await ready;expect(f.b.rewind.value.kind).toBe("ready");f.b.leave();f.link.stop();
});
it("R1 detached old clear never overwrites a same-ID replacement using the same UI setter",async()=>{
  let finish!:(v:{answer:string})=>void,replace=false;const displays:string[]=[];
  const item={threadId:"x"} as Parameters<Branches["excerpts"]>[0];let batch!:ExcerptBatch;
  const publish=(v:{answer?:string})=>{displays.push(v.answer??"empty");};
  batch=new ExcerptBatch(async(_item,cancel)=>{cancel.add(()=>{if(replace){replace=false;batch.show(item,publish);publish({answer:"new UI"});}});return new Promise<{answer:string}>(r=>{finish=r;});});
  batch.show(item,publish);const invalidate=batch.detach();replace=true;invalidate();
  expect(displays.at(-1)).toBe("new UI");finish({answer:"old"});await flush();expect(displays.at(-1)).toBe("new UI");batch.reset();
});
