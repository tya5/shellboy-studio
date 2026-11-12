// Repair regressions; baseline gap characterization is preserved at commit 3b332b7.
// A sent mutation is applied to synthetic state before its reply is dropped.
import { describe, expect, it } from "vitest";
import { Link } from "../../data/src/link";
import { Operations } from "../../data/src/operations";
import { FakeTransport, flush } from "../../data/test/harness";
import { Branches } from "../src/branching";
import { fixtureRewind } from "./fixture";

function fixture() {
  const t = new FakeTransport(); const link = new Link(t); link.start(); t.open();
  let seq = 0; const ops = new Operations(link, () => `receipt-${++seq}`, () => true);
  const b = new Branches(ops);
  const target = { threadId: "selected", nodeId: "split" };
  b.target.value = target;
  return { t, link, ops, b, target };
}
async function ready(f: ReturnType<typeof fixture>) {
  const p = f.b.previewRewind(f.target);
  f.t.ok(f.t.calls("thread.rewind").at(-1)!.id, fixtureRewind); await p;
}

describe("Branches receipt repair", () => {
  for (const changed of [false, true]) it(`rename reply loss retains identity (${changed ? "changed" : "same"} text)`, async () => {
    const f = fixture(); const state = new Map([["selected", "old"], ["parent", "untouched"]]);
    const first = f.b.renameBranch("selected", "name"); const sent = f.t.calls("thread.set")[0]!;
    state.set("selected", "name"); // accepted by synthetic owner; response lost
    f.t.drop(); await first; expect(f.b.actionError.value).toBeTruthy();
    f.t.open();
    // An explicit status observation may be unknown; the Branches model does not retain it.
    const status = f.ops.operationGet(sent.operation_id!); const get = f.t.calls("operation.get")[0]!;
    f.t.ownerError(get.id, "operation_not_found"); expect((await status).ok).toBe(false);
    if (changed) { await f.b.renameBranch("selected", "different"); expect(f.t.calls("thread.set")).toHaveLength(1); }
    const retry = f.b.renameBranch("selected", "name");
    const resent = f.t.calls("thread.set")[1]!;
    expect(resent.operation_id).toBe(sent.operation_id);
    expect(resent.args).toEqual({ thread_id: "selected", title: "name" });
    f.t.drop(); await retry; expect(state.get("parent")).toBe("untouched"); f.b.leave(); f.link.stop();
  });

  it("archive accepted/reply lost retains selection and retry identity; parent is not targeted", async () => {
    const f = fixture(); f.b.toggleBranch("selected"); const archived = new Set<string>();
    const first = f.b.archiveSelected(); const sent = f.t.calls("thread.archive")[0]!;
    expect(sent.args).toEqual({ thread_ids: ["selected"] }); archived.add("selected");
    f.t.drop(); await first; expect([...f.b.selection.value]).toEqual(["selected"]);
    f.t.open(); const retry = f.b.archiveSelected(); const resent = f.t.calls("thread.archive")[1]!;
    expect(resent.operation_id).toBe(sent.operation_id); expect(resent.args).toEqual(sent.args);
    expect(archived.has("parent")).toBe(false); f.t.drop(); await retry; f.b.leave(); f.link.stop();
  });

  it("rewind accepted/reply lost reuses ID and rejects changed follow-up text", async () => {
    const f = fixture(); await ready(f); let applied = 0;
    const first = f.b.confirmRewind("original"); const sent = f.t.calls("thread.rewind")[1]!; applied++;
    f.t.drop(); await first; expect(f.b.rewind.value.kind).toBe("failed");
    f.t.open(); await f.b.confirmRewind("changed"); expect(f.t.calls("thread.rewind")).toHaveLength(2);
    const retry = f.b.confirmRewind("original"); const resent = f.t.calls("thread.rewind")[2]!;
    expect(resent.operation_id).toBe(sent.operation_id);
    expect(resent.args).toEqual(sent.args); applied++;
    f.t.ok(resent.id, { ...fixtureRewind, dry_run: false, branch_thread_id: "kept" }); await flush();
    const send = f.t.calls("message.send")[0]!;
    expect(send.args).toEqual({ thread_id: "selected", text: "original" }); expect(applied).toBe(2);
    f.t.drop(); await retry; f.b.leave(); f.link.stop();
  });

  for (const lost of [false, true]) it(`rewind success + send ${lost ? "reply loss" : "refusal"} does not repeat rewind and retains follow-up receipt`, async () => {
    const f = fixture(); await ready(f);
    const p = f.b.confirmRewind("follow-up"); const rewind = f.t.calls("thread.rewind")[1]!;
    f.t.ok(rewind.id, { ...fixtureRewind, dry_run: false, branch_thread_id: "kept" }); await flush();
    const send = f.t.calls("message.send")[0]!;
    expect(send.args).toEqual({ thread_id: "selected", text: "follow-up" });
    if (lost) f.t.drop(); else f.t.ownerError(send.id, "thread_busy");
    await p; expect(f.b.rewind.value.kind).toBe("idle"); expect(f.b.actionError.value).toContain("Rewind succeeded; request Not confirmed; may have applied (");
    await f.b.confirmRewind("changed");
    expect(f.t.calls("thread.rewind").filter(c => !(c.args as {dry_run?:boolean}).dry_run)).toHaveLength(1);
    expect(f.t.calls("message.send")).toHaveLength(1);
    // Family reread clears rewind state to idle, discarding its completed facts.
    // No retained send outcome API: accepted-but-unconfirmed must not be called 'not sent'.
    if (lost) expect(f.t.calls("operation.get")).toHaveLength(0);
    if (lost) f.t.open();
    const recover = f.b.confirmRewind("follow-up"); await flush();
    const resend = f.t.calls("message.send")[1]!; expect(resend.operation_id).toBe(send.operation_id); expect(resend.args).toEqual(send.args);
    expect(f.t.calls("thread.rewind").filter(c => !(c.args as {dry_run?:boolean}).dry_run)).toHaveLength(1);
    f.t.ok(resend.id,{message_id:"accepted-message",thread_id:(resend.args as {thread_id:string}).thread_id}); await recover;
    f.b.leave(); f.link.stop();
  });
});

it("bounds three independent slots, joins in-flight attempts and refuses new payloads without evicting", async () => {
  const f = fixture();
  const one = f.b.renameBranch("selected", "x"), joined = f.b.renameBranch("selected", "x");
  await f.b.renameBranch("other", "y"); expect(f.t.calls("thread.set")).toHaveLength(1);
  f.b.toggleBranch("selected"); const archive = f.b.archiveSelected(); expect(f.t.calls("thread.archive")).toHaveLength(1);
  await ready(f); const chain = f.b.confirmRewind("x"); expect(f.t.calls("thread.rewind")).toHaveLength(2);
  f.t.drop(); await Promise.all([one, joined, archive, chain]);
  f.b.clearActions(); f.b.leave();
  f.t.open(); await f.b.renameBranch("other", "y"); f.b.toggleBranch("parent"); await f.b.archiveSelected();
  expect(f.t.calls("thread.set")).toHaveLength(1); expect(f.t.calls("thread.archive")).toHaveLength(1);
  // The same three immutable slots remain recoverable after clear/leave.
  const retry = f.b.renameBranch("selected", "x"); expect(f.t.calls("thread.set")[1]!.operation_id).toBe(f.t.calls("thread.set")[0]!.operation_id);
  f.t.drop(); await retry; f.link.stop();
});

it("retains identities across expired/invalid outcomes and rejects cross-owner mutation replay", async () => {
  const t = new FakeTransport(), link = new Link(t); link.start(); t.open(); let owner = "owner-a", seq = 0;
  const b = new Branches(new Operations(link, () => `${owner}:${++seq}`, () => true), () => owner);
  const first = b.renameBranch("a", "title"); const call = t.calls("thread.set")[0]!;
  t.ownerError(call.id,"operation_expired"); await first;
  const retry = b.renameBranch("a","title"); const second = t.calls("thread.set")[1]!; expect(second.operation_id).toBe(call.operation_id);
  t.ok(second.id,"invalid details"); await retry;
  owner = "owner-b"; const lookup = b.renameBranch("a","title"); const get = t.calls("operation.get")[0]!; t.ok(get.id,{operation_id:call.operation_id,state:"completed",replay_policy:"return_saved_outcome",outcome:{result:{thread_id:"a",title:"title"}}}); await lookup; expect(t.calls("thread.set")).toHaveLength(2);
  owner = "owner-a"; const last = b.renameBranch("a","title"); expect(t.calls("thread.set")[2]!.operation_id).toBe(call.operation_id); t.drop(); await last; link.stop();
});

it("stores late outcomes in the original slot, never the new Thread projection", async () => {
  const f = fixture(); f.b.state.value = { ...f.b.state.value, threadId:"selected" };
  const p=f.b.renameBranch("selected","x"); const sent=f.t.calls("thread.set")[0]!;
  f.b.state.value={...f.b.state.value,threadId:"other"}; f.b.actionError.value="other projection";
  f.t.ownerError(sent.id,"operation_expired"); await p; expect(f.b.actionError.value).toBe("other projection");
  await f.b.renameBranch("other","y"); expect(f.t.calls("thread.set")).toHaveLength(1);
  f.b.state.value={...f.b.state.value,threadId:"selected"}; const retry=f.b.renameBranch("selected","x");
  expect(f.t.calls("thread.set")[1]!.operation_id).toBe(sent.operation_id);f.t.drop();await retry;f.link.stop();
});

it("distinguishes definite pre-send refusal from lost replies and never reruns a completed chain", async () => {
  const f=fixture(); await ready(f); const p=f.b.confirmRewind("follow-up");
  f.t.ok(f.t.calls("thread.rewind")[1]!.id,{...fixtureRewind,dry_run:false});
  // Drop immediately before the await continuation can attempt message.send.
  f.t.drop();await p;expect(f.b.actionError.value).toContain("Not sent:");expect(f.t.calls("message.send")).toHaveLength(0);
  f.t.open();const retry=f.b.confirmRewind("follow-up");await flush();const sent=f.t.calls("message.send")[0]!;
  f.t.ok(sent.id,{message_id:"accepted-message",thread_id:(sent.args as {thread_id:string}).thread_id});await retry;await f.b.confirmRewind("follow-up");
  expect(f.t.calls("thread.rewind").filter(c=>!(c.args as {dry_run?:boolean}).dry_run)).toHaveLength(1);
  expect(f.t.calls("message.send")).toHaveLength(1);f.link.stop();
});

it("opaque/malformed lookup never advances a stage or releases its slot", async () => {
  const t=new FakeTransport(),link=new Link(t);link.start();t.open();let owner="a",seq=0;
  const b=new Branches(new Operations(link,()=>`${owner}:${++seq}`, () => true),()=>owner);
  const first=b.renameBranch("selected","name");const sent=t.calls("thread.set")[0]!;t.drop();await first;t.open();owner="b";
  for(const result of [{operation_id:sent.operation_id,state:"completed",replay_policy:"return_saved_outcome",outcome:{result:{thread_id:"selected",title:"name"}}},{operation_id:"wrong",state:"completed"}]){
    const retry=b.renameBranch("selected","name");t.ok(t.calls("operation.get").at(-1)!.id,result);await retry;
    await b.renameBranch("other","changed");expect(t.calls("thread.set")).toHaveLength(1);
  }
  owner="a";const retry=b.renameBranch("selected","name");const same=t.calls("thread.set")[1]!;expect(same.operation_id).toBe(sent.operation_id);
  t.ok(same.id,{thread_id:"selected",title:"name"});await retry;await b.renameBranch("selected","name");expect(t.calls("thread.set")).toHaveLength(2);link.stop();
});

it("read/clear/leave never discard receipt; late rewind success cannot start a fresh stage in another view", async () => {
  const f=fixture();await ready(f);f.b.state.value={...f.b.state.value,threadId:"selected"};
  const p=f.b.confirmRewind("frozen");const call=f.t.calls("thread.rewind")[1]!;
  f.b.clearActions();f.b.leave();const reading=f.b.read("other");
  const list=f.t.calls("thread.branches").at(-1)!;f.t.ok(list.id,{root_thread_id:"other",items:[],total:0});await reading;
  f.b.actionError.value="other";f.t.ok(call.id,{...fixtureRewind,dry_run:false});await p;
  expect(f.t.calls("message.send")).toHaveLength(0);expect(f.b.actionError.value).toBe("other");
  f.b.target.value={threadId:"other",nodeId:"else"};await f.b.confirmRewind("changed");expect(f.t.calls("thread.rewind")).toHaveLength(2);
  f.b.state.value={...f.b.state.value,threadId:"selected"};f.b.target.value=f.target;
  const recover=f.b.confirmRewind("frozen");await flush();const send=f.t.calls("message.send")[0]!;
  f.t.ok(send.id,{message_id:"accepted-message",thread_id:(send.args as {thread_id:string}).thread_id});await recover;expect(f.t.calls("thread.rewind")).toHaveLength(2);f.link.stop();
});

it("owner change after a known rewind never starts the unsent send stage", async () => {
  const t=new FakeTransport(),link=new Link(t);link.start();t.open();let owner="a",id=0;
  const b=new Branches(new Operations(link,()=>`${owner}:${++id}`, () => true),()=>owner);const target={threadId:"selected",nodeId:"split"};b.target.value=target;
  const preview=b.previewRewind(target);t.ok(t.calls("thread.rewind")[0]!.id,fixtureRewind);await preview;
  const p=b.confirmRewind("text");t.ok(t.calls("thread.rewind")[1]!.id,{...fixtureRewind,dry_run:false});owner="b";await p;
  expect(t.calls("message.send")).toHaveLength(0);const diagnostic=b.confirmRewind("text");const get=t.calls("operation.get").at(-1)!;t.ownerError(get.id,"operation_expired");await diagnostic;expect(t.calls("message.send")).toHaveLength(0);
  owner="a";const resume=b.confirmRewind("text");await flush();t.ok(t.calls("message.send")[0]!.id,{message_id:"accepted-message",thread_id:(t.calls("message.send")[0]!.args as {thread_id:string}).thread_id});await resume;link.stop();
});

it("admits no more than four mutation receipts across all three occupied slots", async () => {
  const f=fixture();
  const rename=f.b.renameBranch("selected","frozen");
  f.b.toggleBranch("selected");const archive=f.b.archiveSelected();await ready(f);
  const chain=f.b.confirmRewind("frozen");const rewind=f.t.calls("thread.rewind").at(-1)!;
  f.t.ok(rewind.id,{...fixtureRewind,dry_run:false});await flush();
  const mutations=()=>f.t.calls().filter(c=>c.operation_id);
  expect(new Set(mutations().map(c=>c.operation_id)).size).toBe(4);
  await f.b.renameBranch("other","changed");f.b.toggleBranch("parent");await f.b.archiveSelected();await f.b.confirmRewind("changed");
  expect(new Set(mutations().map(c=>c.operation_id)).size).toBe(4);
  expect(f.t.calls("message.send")[0]!.args).toEqual({thread_id:"selected",text:"frozen"});
  f.t.drop();await Promise.all([rename,archive,chain]);f.link.stop();
});

it("reserves pending state before a synchronous transport callback can reenter", async () => {
  const f=fixture();const original=f.t.send.bind(f.t);let reentered=false;let joined:Promise<void>|undefined;
  f.t.send=frame=>{const sent=original(frame);if(frame.t==="call"&&frame.command==="thread.set"&&!reentered){reentered=true;joined=f.b.renameBranch("selected","fixed");}return sent;};
  const first=f.b.renameBranch("selected","fixed");expect(f.t.calls("thread.set")).toHaveLength(1);
  f.t.ok(f.t.calls("thread.set")[0]!.id,{thread_id:"selected",title:"fixed"});await first;await joined;f.link.stop();
});

function ownerFixture() {
  const t=new FakeTransport(),link=new Link(t);link.start();t.open();let owner:string|undefined="a",seq=0;
  const b=new Branches(new Operations(link,()=>`${owner}:${++seq}`, () => true),()=>owner);
  const change=(next:string|undefined)=>{owner=next;b.ownerChanged(next);};change("a");
  return {t,link,b,change};
}
for(const kind of ["rename","archive"] as const) for(const returns of [false,true]) it(`${kind} late success after owner ${returns?"A-B-A":"A-B"} has no projection or read effect`,async()=>{
  const f=ownerFixture();f.b.state.value={...f.b.state.value,threadId:"selected"};f.b.toggleBranch("selected");
  const p=kind==="rename"?f.b.renameBranch("selected","x"):f.b.archiveSelected();
  const call=f.t.calls(kind==="rename"?"thread.set":"thread.archive")[0]!;f.change("b");if(returns)f.change("a");f.b.actionError.value="new owner";
  f.t.ok(call.id,kind==="rename"?{thread_id:"selected",title:"x"}:{archived:["selected"],not_found:[]});await p;
  expect(f.b.actionError.value).toBe("new owner");expect([...f.b.selection.value]).toEqual(["selected"]);expect(f.t.calls("thread.branches")).toHaveLength(0);f.link.stop();
});
it("cached canonical success belongs only to the original owner, retained through opaque lookup",async()=>{
  const f=ownerFixture();const p=f.b.renameBranch("selected","x");f.t.ok(f.t.calls("thread.set")[0]!.id,{thread_id:"selected",title:"x"});await p;
  f.change("b");f.b.actionError.value="new owner";const other=f.b.renameBranch("selected","x");
  f.t.ok(f.t.calls("operation.get")[0]!.id,{operation_id:f.t.calls("thread.set")[0]!.operation_id,state:"completed",replay_policy:"return_saved_outcome",outcome:{result:{}}});await other;
  expect(f.b.actionError.value).toBe("new owner");expect(f.t.calls("thread.set")).toHaveLength(1);
  f.change("a");await f.b.renameBranch("selected","x");expect(f.b.actionError.value).toBeUndefined();expect(f.t.calls("thread.set")).toHaveLength(1);f.link.stop();
});
it("explicit original-owner rejoin cannot revive the old await continuation",async()=>{
  const f=ownerFixture();f.b.state.value={...f.b.state.value,threadId:"selected"};const first=f.b.renameBranch("selected","x");
  f.change("b");f.change("a");const explicit=f.b.renameBranch("selected","x");
  f.t.ok(f.t.calls("thread.set")[0]!.id,{thread_id:"selected",title:"x"});await first;await explicit;
  expect(f.t.calls("thread.set")).toHaveLength(1);expect(f.t.calls("thread.branches")).toHaveLength(1);f.link.stop();
});
for(const stage of ["rewind","send"] as const) it(`owner roundtrip during ${stage} never starts or projects a late chain`,async()=>{
  const f=ownerFixture();const target={threadId:"selected",nodeId:"split"};f.b.target.value=target;
  const preview=f.b.previewRewind(target);f.t.ok(f.t.calls("thread.rewind")[0]!.id,fixtureRewind);await preview;
  const p=f.b.confirmRewind("fixed");const rewind=f.t.calls("thread.rewind")[1]!;
  if(stage==="send"){f.t.ok(rewind.id,{...fixtureRewind,dry_run:false});await flush();}
  f.change("b");f.change("a");f.b.actionError.value="new epoch";
  if(stage==="rewind")f.t.ok(rewind.id,{...fixtureRewind,dry_run:false});else f.t.ok(f.t.calls("message.send")[0]!.id,{message_id:"accepted-message",thread_id:(f.t.calls("message.send")[0]!.args as {thread_id:string}).thread_id});
  await p;expect(f.b.actionError.value).toBe("new epoch");expect(f.t.calls("thread.branches")).toHaveLength(0);
  expect(f.t.calls("message.send")).toHaveLength(stage==="send"?1:0);
  await f.b.confirmRewind("changed");expect(f.t.calls("thread.rewind")).toHaveLength(2);f.link.stop();
});
it("unavailable owner roundtrip invalidates late results and unknown owner cannot start mutation",async()=>{
  const f=ownerFixture();const p=f.b.renameBranch("selected","x");f.change(undefined);f.change("a");f.b.actionError.value="untouched";
  f.t.ok(f.t.calls("thread.set")[0]!.id,{thread_id:"selected",title:"x"});await p;expect(f.b.actionError.value).toBe("untouched");
  f.change(undefined);await f.b.renameBranch("other","new");expect(f.t.calls("thread.set")).toHaveLength(1);f.link.stop();
});
