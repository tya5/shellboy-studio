import { effect } from "@preact/signals-core";
import { expect, it } from "vitest";
import { Link } from "../../data/src/link";
import { Operations } from "../../data/src/operations";
import { FakeTransport, flush, connected } from "../../data/test/harness";
import { Branches } from "../src/branching";
import { fixtureModel, fixtureRewind } from "./fixture";

function fixture(){
  const t=new FakeTransport(),link=new Link(t);link.start();t.open();let owner:string|undefined="a",seq=0;
  const b=new Branches(new Operations(link,()=>`${owner}:${++seq}`),()=>owner);b.ownerChanged(owner);
  const change=(next:string|undefined)=>{owner=next;b.ownerChanged(next);};
  return {t,link,b,change};
}
const empty={root_thread_id:"selected",items:[],total:0};
it("family/batch resets retain a pending immutable mutation and coalesce success refresh",async()=>{
  const f=fixture();f.b.state.value={...f.b.state.value,threadId:"selected",loading:false};
  const rename=f.b.renameBranch("selected","fixed");const sent=f.t.calls("thread.set")[0]!;
  const reading=f.b.read("selected");f.b.excerptBatch.reset();
  f.t.ok(f.t.calls("thread.branches")[0]!.id,empty);await reading;
  f.t.ok(sent.id,{thread_id:"selected",title:"fixed"});await rename;
  expect(f.t.calls("thread.set")).toHaveLength(1);expect(f.t.calls("thread.branches")).toHaveLength(2);
  f.t.ok(f.t.calls("thread.branches")[1]!.id,empty);await flush();
  await f.b.renameBranch("selected","fixed");expect(f.t.calls("thread.set")).toHaveLength(1);
  f.b.leave();f.link.stop();
});
it("owner roundtrip cancels family/excerpt adoption and late rename has zero read side effects",async()=>{
  const f=fixture();f.b.state.value={...f.b.state.value,threadId:"selected",loading:false};
  const rename=f.b.renameBranch("selected","fixed");const sent=f.t.calls("thread.set")[0]!;
  const reading=f.b.read("selected");const family=f.t.calls("thread.branches")[0]!;
  const facts:{answer?:string}[]=[];f.b.excerptBatch.show({threadId:"child",title:"child",tipNodeId:"tip"} as Parameters<typeof f.b.excerpts>[0],x=>facts.push(x));
  const window=f.t.calls("history.window")[0]!;f.change("b");f.change("a");f.b.actionError.value="new epoch";
  const count=facts.length;f.t.ok(family.id,empty);f.t.ok(window.id,{thread_id:"child",revision:1,total:0,items:[]});f.t.ok(sent.id,{thread_id:"selected",title:"fixed"});
  await reading;await rename;await flush();expect(f.b.state.value.family).toBeUndefined();expect(facts).toHaveLength(count);
  expect(f.b.actionError.value).toBe("new epoch");expect(f.t.calls("thread.branches")).toHaveLength(1);f.b.leave();f.link.stop();
});
it("partial rewind retains send receipt through family/excerpt resets and leave retains canonical result",async()=>{
  const f=fixture();const target={threadId:"selected",nodeId:"split"};f.b.target.value=target;
  const preview=f.b.previewRewind(target);f.t.ok(f.t.calls("thread.rewind")[0]!.id,fixtureRewind);await preview;
  const first=f.b.confirmRewind("fixed");f.t.ok(f.t.calls("thread.rewind")[1]!.id,{...fixtureRewind,dry_run:false});await flush();
  const send=f.t.calls("message.send")[0]!;f.t.drop();await first;f.t.open();
  const reading=f.b.read("selected");f.b.excerptBatch.reset();f.t.ok(f.t.calls("thread.branches").at(-1)!.id,empty);await reading;
  f.b.target.value=target;const retry=f.b.confirmRewind("fixed");await flush();const resent=f.t.calls("message.send")[1]!;
  expect(resent.operation_id).toBe(send.operation_id);expect(resent.args).toEqual(send.args);expect(f.t.calls("thread.rewind")).toHaveLength(2);
  f.b.leave();f.t.ok(resent.id,{message_id:"accepted-message",thread_id:(resent.args as {thread_id:string}).thread_id});await retry;const reads=f.t.calls("thread.branches").length;
  await f.b.confirmRewind("fixed");expect(f.t.calls("message.send")).toHaveLength(2);expect(f.t.calls("thread.branches")).toHaveLength(reads+1);f.link.stop();
});

for(const transition of ["aba","unavailable","other"] as const) it(`family loading converges after ${transition} and same-Thread ensure can adopt fresh results`,async()=>{
  const f=fixture();const old=f.b.read("selected");const first=f.t.calls("thread.branches")[0]!;
  f.change(transition==="unavailable"?undefined:"b");if(transition!=="other")f.change("a");
  expect(f.b.state.value.loading).toBe(false);f.t.ok(first.id,empty);await old;f.b.ensure("selected");
  expect(f.t.calls("thread.branches")).toHaveLength(2);expect(f.b.state.value.loading).toBe(true);
  f.t.ok(f.t.calls("thread.branches")[1]!.id,empty);await flush();expect(f.b.state.value.loading).toBe(false);expect(f.b.state.value.family).toBeDefined();f.b.leave();f.link.stop();
});


it("invalidation notification can queue one fresh read without old cancellation clearing it",async()=>{
  const f=fixture();const old=f.b.read("selected");let armed=true;
  const stop=effect(()=>{const state=f.b.state.value;if(armed&&!state.loading&&state.threadId==="selected"){armed=false;f.b.ensure("selected");}});
  f.change("b");expect(f.b.state.value.loading).toBe(true);await flush();
  expect(f.t.calls("thread.branches")).toHaveLength(2);expect(f.b.state.value.loading).toBe(true);
  f.t.ok(f.t.calls("thread.branches")[1]!.id,empty);await old;await flush();expect(f.b.state.value.family).toBeDefined();stop();f.b.leave();f.link.stop();
});
it("leave reentered from invalidation cancels trailing intent with no fresh RPC",async()=>{
  const f=fixture();const old=f.b.read("selected");let armed=true;
  const stop=effect(()=>{const state=f.b.state.value;if(armed&&!state.loading&&state.threadId==="selected"){armed=false;f.b.ensure("selected");f.b.leave();}});
  f.change("b");await old;await flush();expect(f.t.calls("thread.branches")).toHaveLength(1);expect(f.b.state.value.loading).toBe(false);stop();f.link.stop();
});

it("AppModel owner notification restores ensure eligibility after unreachable without adopting old family",async()=>{
  const {model,t}=await fixtureModel();const before=t.calls("thread.branches").length;
  const old=model.branches.read("selected");
  t.push({t:"owner",event:"unreachable",owner:{state:"unreachable"}});
  t.push({t:"owner",event:"connected",owner:connected});await old;
  expect(model.branches.state.value.loading).toBe(false);model.branches.ensure("selected");
  expect(t.calls("thread.branches")).toHaveLength(before+2);
  t.ok(t.calls("thread.branches").at(-1)!.id,empty);await flush();expect(model.branches.state.value.family).toBeDefined();model.dispose();
});
