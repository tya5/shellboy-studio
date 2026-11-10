// Repair assertions; unresolved baseline diagnostics are preserved at b5d1019.
import { effect } from "@preact/signals-core";
import { describe, expect, it } from "vitest";
import { Link } from "../../data/src/link";
import { Operations } from "../../data/src/operations";
import { FakeTransport, flush } from "../../data/test/harness";
import { Branches } from "../src/branching";

function fixture() {
  const t = new FakeTransport(), link = new Link(t); link.start(); t.open();
  let owner: string | undefined = "a", seq = 0;
  const b = new Branches(new Operations(link, () => `${owner}:${++seq}`), () => owner);
  b.ownerChanged(owner);
  const target = { threadId: "parent", nodeId: "point" }; b.target.value = target;
  return { t, link, b, target, change(next: string | undefined) { owner = next; b.ownerChanged(next); } };
}
const child = { thread_id: "child", title: "child" };
describe("fork receipt repair", () => {
  it("lost reply retries identical fork ID/args and never targets parent rewind", async () => {
    const f=fixture();const first=f.b.forkAt(f.target);const one=f.t.calls("thread.fork")[0]!;
    f.t.drop();await first;f.t.open();const retry=f.b.forkAt(f.target);const two=f.t.calls("thread.fork")[1]!;
    expect(two.operation_id).toBe(one.operation_id);expect(two.args).toEqual(one.args);expect(two.args).toEqual({thread_id:"parent",node_id:"point"});
    expect(f.t.calls("thread.rewind")).toHaveLength(0);f.t.drop();await retry;f.link.stop();
  });
  it("inflight duplicates join and changed payload is refused",async()=>{
    const f=fixture();const a=f.b.forkAt(f.target,"fixed"),b=f.b.forkAt(f.target," fixed ");
    await f.b.forkAt(f.target,"changed");expect(f.t.calls("thread.fork")).toHaveLength(1);
    f.t.drop();await Promise.all([a,b]);f.link.stop();
  });
  for(const roundtrip of [false,true]) it(`late fork success after owner change${roundtrip?" and return":""} cannot send or project`,async()=>{
    const f=fixture();const p=f.b.forkAt(f.target,"fixed");f.change("b");if(roundtrip)f.change("a");f.b.actionError.value="new owner";
    f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await p;
    expect(f.t.calls("message.send")).toHaveLength(0);expect(f.b.actionError.value).toBe("new owner");expect(f.t.calls("thread.branches")).toHaveLength(0);f.link.stop();
  });
  it("leave invalidates late result but explicit return recovers the known child without refork",async()=>{
    const f=fixture();const p=f.b.forkAt(f.target,"fixed");f.b.leave();f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await p;
    expect(f.t.calls("message.send")).toHaveLength(0);expect(f.t.calls("thread.branches")).toHaveLength(0);
    const retry=f.b.forkAt(f.target,"fixed");await flush();expect(f.t.calls("thread.fork")).toHaveLength(1);
    f.t.ok(f.t.calls("message.send")[0]!.id,{message_id:"accepted-message",thread_id:(f.t.calls("message.send")[0]!.args as {thread_id:string}).thread_id});await retry;f.link.stop();
  });
  for(const lost of [false,true]) it(`partial send ${lost?"reply loss":"refusal"} retries only send with identical ID`,async()=>{
    const f=fixture();const p=f.b.forkAt(f.target,"fixed");f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await flush();const send=f.t.calls("message.send")[0]!;
    if(lost)f.t.drop();else f.t.ownerError(send.id,"thread_busy");await p;
    expect(f.b.actionError.value).toContain("Not confirmed; may have applied");
    if(lost)f.t.open();await f.b.forkAt(f.target,"changed");expect(f.t.calls("thread.fork")).toHaveLength(1);
    const retry=f.b.forkAt(f.target,"fixed");await flush();const resent=f.t.calls("message.send")[1]!;
    expect(resent.operation_id).toBe(send.operation_id);expect(resent.args).toEqual({thread_id:"child",text:"fixed"});
    f.t.ok(resent.id,{message_id:"accepted-message",thread_id:(resent.args as {thread_id:string}).thread_id});await retry;expect(f.t.calls("thread.fork")).toHaveLength(1);f.link.stop();
  });
});

it("old-owner opaque receipt cannot establish success; explicit original-owner retry keeps the ID",async()=>{
  const f=fixture();const p=f.b.forkAt(f.target,"fixed");const sent=f.t.calls("thread.fork")[0]!;f.t.drop();await p;f.t.open();f.change("b");
  const lookup=f.b.forkAt(f.target,"fixed");f.t.ok(f.t.calls("operation.get")[0]!.id,{operation_id:sent.operation_id,state:"completed",replay_policy:"return_saved_outcome",outcome:{result:child}});await lookup;
  expect(f.t.calls("thread.fork")).toHaveLength(1);expect(f.t.calls("message.send")).toHaveLength(0);
  f.change("a");const retry=f.b.forkAt(f.target,"fixed");expect(f.t.calls("thread.fork")[1]!.operation_id).toBe(sent.operation_id);
  f.t.ok(f.t.calls("thread.fork")[1]!.id,child);await flush();f.t.ok(f.t.calls("message.send")[0]!.id,{message_id:"accepted-message",thread_id:(f.t.calls("message.send")[0]!.args as {thread_id:string}).thread_id});await retry;f.link.stop();
});
it("owner unavailable roundtrip during send keeps the original receipt and blocks late projection",async()=>{
  const f=fixture();const p=f.b.forkAt(f.target,"fixed");f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await flush();const send=f.t.calls("message.send")[0]!;
  f.change(undefined);f.change("a");f.b.actionError.value="new epoch";f.t.ok(send.id,{message_id:"accepted-message",thread_id:(send.args as {thread_id:string}).thread_id});await p;
  expect(f.b.actionError.value).toBe("new epoch");expect(f.t.calls("thread.branches")).toHaveLength(0);
  await f.b.forkAt(f.target,"fixed");expect(f.t.calls("thread.fork")).toHaveLength(1);expect(f.t.calls("message.send")).toHaveLength(1);f.link.stop();
});
it("same owner explicit rejoin cannot revive a fork continuation from before owner ABA",async()=>{
  const f=fixture();const first=f.b.forkAt(f.target,"fixed");f.change("b");f.change("a");const joined=f.b.forkAt(f.target,"fixed");
  f.b.actionError.value="new epoch";f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await first;await joined;
  expect(f.t.calls("message.send")).toHaveLength(0);expect(f.b.actionError.value).toBe("new epoch");
  const explicit=f.b.forkAt(f.target,"fixed");await flush();expect(f.t.calls("message.send")).toHaveLength(1);
  f.t.ok(f.t.calls("message.send")[0]!.id,{message_id:"accepted-message",thread_id:(f.t.calls("message.send")[0]!.args as {thread_id:string}).thread_id});await explicit;f.link.stop();
});
it("synchronous transport reentry joins before the first fork send",async()=>{
  const f=fixture();const original=f.t.send.bind(f.t);let reentered=false,joined:Promise<void>|undefined;
  f.t.send=frame=>{const result=original(frame);if(frame.t==="call"&&frame.command==="thread.fork"&&!reentered){reentered=true;joined=f.b.forkAt(f.target);}return result;};
  const first=f.b.forkAt(f.target);expect(f.t.calls("thread.fork")).toHaveLength(1);f.t.drop();await first;await joined;f.link.stop();
});
it("expired/invalid canonical responses retain immutable ID and refuse changed parent or text",async()=>{
  const f=fixture();const first=f.b.forkAt(f.target,"fixed");const sent=f.t.calls("thread.fork")[0]!;f.t.ownerError(sent.id,"operation_expired");await first;
  const retry=f.b.forkAt(f.target,"fixed");const same=f.t.calls("thread.fork")[1]!;expect(same.operation_id).toBe(sent.operation_id);f.t.ok(same.id,"malformed");await retry;
  await f.b.forkAt({threadId:"other",nodeId:"other"},"fixed");await f.b.forkAt(f.target,"changed");expect(f.t.calls("thread.fork")).toHaveLength(2);f.link.stop();
});
it("four independent slots reserve no more than six mutation receipts",async()=>{
  const f=fixture();const rename=f.b.renameBranch("parent","name");f.b.toggleBranch("other");const archive=f.b.archiveSelected();
  const preview=f.b.previewRewind(f.target);f.t.ok(f.t.calls("thread.rewind")[0]!.id,{removed_node_count:1});await preview;
  const rewind=f.b.confirmRewind("rewind input");f.t.ok(f.t.calls("thread.rewind")[1]!.id,{removed_node_count:1});await flush();
  const fork=f.b.forkAt(f.target,"fork input");f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await flush();
  const ids=()=>new Set(f.t.calls().filter(c=>c.operation_id).map(c=>c.operation_id));expect(ids().size).toBe(6);
  await f.b.forkAt(f.target,"changed");expect(ids().size).toBe(6);
  expect(f.t.calls("message.send").map(c=>(c.args as {thread_id:string}).thread_id)).toEqual(["parent","child"]);
  f.t.drop();await Promise.all([rename,archive,rewind,fork]);f.link.stop();
});

it("synchronous forking notification invalidation cannot dispatch even after owner ABA",async()=>{
  const f=fixture();const stop=effect(()=>{if(f.b.fork.value.kind==="forking"){f.change("b");f.change("a");}});
  await f.b.forkAt(f.target,"fixed");expect(f.t.calls("thread.fork")).toHaveLength(0);expect(f.t.calls("message.send")).toHaveLength(0);
  stop();const resume=f.b.forkAt(f.target,"fixed");expect(f.t.calls("thread.fork")).toHaveLength(1);f.t.drop();await resume;f.link.stop();
});
it("unknown owner starts no fork and changing the selected node blocks late follow-up",async()=>{
  const f=fixture();f.change(undefined);await f.b.forkAt(f.target,"fixed");expect(f.t.calls("thread.fork")).toHaveLength(0);
  f.change("a");const p=f.b.forkAt(f.target,"fixed");f.b.target.value={...f.target,nodeId:"different"};f.b.actionError.value="new point";
  f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await p;expect(f.t.calls("message.send")).toHaveLength(0);expect(f.b.actionError.value).toBe("new point");f.link.stop();
});

for (const invalidation of ["owner", "aba", "leave", "target"] as const) it(`done notification ${invalidation} invalidates refresh before dispatch`,async()=>{
  const f=fixture();const stop=effect(()=>{if(f.b.fork.value.kind!=="done")return;
    if(invalidation==="owner")f.change("b");
    if(invalidation==="aba"){f.change("b");f.change("a");}
    if(invalidation==="leave")f.b.leave();
    if(invalidation==="target")f.b.target.value={...f.target,nodeId:"different"};
  });
  const p=f.b.forkAt(f.target);f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await p;
  expect(f.t.calls("thread.branches")).toHaveLength(0);expect(f.t.calls("message.send")).toHaveLength(0);
  stop();f.link.stop();
});

it("failed notification invalidation preserves the new owner's error",async()=>{
  const f=fixture();const stop=effect(()=>{if(f.b.fork.value.kind==="failed"){f.change("b");f.b.actionError.value="new owner error";}});
  const p=f.b.forkAt(f.target);f.t.ownerError(f.t.calls("thread.fork")[0]!.id,"operation_expired");await p;
  expect(f.b.actionError.value).toBe("new owner error");expect(f.t.calls("thread.branches")).toHaveLength(0);stop();f.link.stop();
});
it("partial-send error notification invalidation cannot publish stale done",async()=>{
  const f=fixture();const stop=effect(()=>{if(f.b.actionError.value?.startsWith("Branch child created"))f.change("b");});
  const p=f.b.forkAt(f.target,"fixed");f.t.ok(f.t.calls("thread.fork")[0]!.id,child);await flush();
  f.t.ownerError(f.t.calls("message.send")[0]!.id,"thread_busy");await p;
  expect(f.b.fork.value.kind).not.toBe("done");expect(f.t.calls("thread.branches")).toHaveLength(0);stop();f.link.stop();
});
