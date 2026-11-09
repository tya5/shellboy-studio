import { effect, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { describe, expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { HumanInbox, HUMAN_PAGE_LIMIT } from "../src/pending";
import { FakeTransport, connected, details, flush, summary } from "./harness";

const writable = <T>(s: ReadonlySignal<T>): Signal<T> => s as Signal<T>;
const ownerB = { ...connected, info: { ...(connected.state === "connected" ? connected.info : {}), instance_id: "owner-b" } } as typeof connected;

async function fixture() {
  const t = new FakeTransport(); let seq = 0;
  const data = new ShellboyData({ transport: t, newId: () => `uuid-${++seq}` });
  const inbox = new HumanInbox(data); const list = data.trackThreadList(); data.start(); t.open();
  t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  await flush(); t.ok(t.calls("thread.list").find(c => !(c.args as Record<string, unknown>).awaiting)!.id, { items: [] }); await flush();
  const close = () => { inbox.close(); list.close(); data.stop(); };
  return { t, data, inbox, close };
}
const human = (id: string) => ({ message_id: id, recipient_kind: "human", recipient_thread_id: "a", excerpt: `Question ${id}`, delivery_status: "accepted" });
async function fill(f: Awaited<ReturnType<typeof fixture>>, cursor?: string) {
  const list = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!;
  expect(list.args).toEqual({ awaiting: "human", limit: HUMAN_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
  f.t.ok(list.id, { items: [summary("a", { awaiting_human_count: 17, awaiting_human_count_exact: false })], next_cursor: "next-key" }); await flush();
  f.t.ok(f.t.calls("thread.get").at(-1)!.id, details("a", { awaiting_replies: [human("h"), { ...human("q"), recipient_kind: "thread", recipient_thread_id: "other" }] })); await flush();
}
describe("bounded protocol5 human inbox", () => {
  it("reads only its page, preserves 17+/unknown oldest, filters Thread duties and keysets", async () => {
    const f = await fixture(); await fill(f);
    expect(f.inbox.items.value).toEqual([{ id: "h", threadId: "a", threadTitle: "t-a", question: "Question h", askedAt: undefined, count: 17, countExact: false }]);
    expect(f.t.calls("thread.get").map(c => (c.args as Record<string, unknown>).thread_id)).toEqual(["a"]);
    const more = f.inbox.more(); await flush(); await fill(f, "next-key"); await more;
    expect(f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting)).toHaveLength(2);
    expect(f.t.calls("thread.get")).toHaveLength(2);
    f.close();
  });
  it("never sends reply for an unrelated/Thread duty, and coalesces double clicks", async () => {
    const f = await fixture(); await fill(f);
    expect((await f.inbox.answer("q", "no")).ok).toBe(false);
    const first = f.inbox.answer("h", "answer"), duplicate = f.inbox.answer("h", "answer"); await flush();
    expect(f.t.calls("message.reply")).toHaveLength(1);
    const reply = f.t.calls("message.reply")[0]!; expect(reply.args).toEqual({ message_id: "h", text: "answer" });
    f.t.ok(reply.id, {}); await flush(); const list = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!; f.t.ok(list.id, { items: [] }); await flush();
    expect((await first).ok).toBe(true); expect((await duplicate).ok).toBe(true); expect(f.inbox.items.value).toEqual([]); f.close();
  });
  it("reuses an unconfirmed receipt and rejects changed retry text", async () => {
    const f = await fixture(); await fill(f);
    const first = f.inbox.answer("h", "answer"); await flush(); const sent = f.t.calls("message.reply")[0]!;
    f.t.drop(); await flush(); await first;
    f.t.open(); f.t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected }); await flush();
    const base = f.t.calls("thread.list").filter(c => !(c.args as Record<string, unknown>).awaiting).at(-1)!; f.t.ok(base.id, { items: [] }); await flush(); await fill(f);
    expect((await f.inbox.answer("h", "different")).ok).toBe(false);
    const retry = f.inbox.answer("h", "answer"); await flush(); const resent = f.t.calls("message.reply").at(-1)!;
    expect(resent.operation_id).toBe(sent.operation_id); f.t.ok(resent.id, {}); await flush(); f.t.ok(f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!.id, { items: [] }); await retry; f.close();
  });
  it("reports expired cursors instead of silently scanning/restarting, and cancels on close", async () => {
    const f = await fixture(); await fill(f); const more = f.inbox.more(); await flush();
    const list = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!; f.t.ownerError(list.id, "cursor_expired"); await more;
    expect(f.inbox.error.value).toMatchObject({ code: "cursor_expired" }); expect(f.inbox.items.value).toEqual([]); f.close();
  });
});

it("invalidates a stale read before it can publish, keeps unrelated list facts and cancels reads on shutdown", async () => {
  const f = await fixture(); const before = f.data.threadList.value;
  const call = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!;
  f.inbox.close(); await flush(); expect(f.t.cancels()).toContain(call.id);
  f.t.ok(call.id, { items: [summary("unrelated")] }); await flush();
  expect(f.inbox.items.value).toEqual([]); expect(f.data.threadList.value).toEqual(before); f.close();
});

it("fails loud for oversized pages without scanning detail records", async () => {
  const f = await fixture(); const call = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!;
  f.t.ok(call.id, { items: Array.from({ length: HUMAN_PAGE_LIMIT + 1 }, (_, i) => summary(String(i))) }); await flush();
  expect(f.inbox.error.value?.kind).toBe("invalid_response"); expect(f.t.calls("thread.get")).toHaveLength(0); f.close();
});

it("retains displayed questions during same-owner list invalidation and failed reread", async () => {
  const f = await fixture(); await fill(f); const previous = f.inbox.items.value;
  writable(f.data.threadList).value = { ...f.data.threadList.value, loading: true };
  expect(f.inbox.items.value).toBe(previous);
  writable(f.data.threadList).value = { ...f.data.threadList.value, loading: false, stale: false, loaded: true };
  await flush(); const call = f.t.calls("thread.list").filter(c => (c.args as Record<string,unknown>).awaiting).at(-1)!;
  f.t.ownerError(call.id,"temporarily_unavailable"); await flush();
  expect(f.inbox.items.value).toBe(previous); expect(f.inbox.error.value).toBeDefined(); f.close();
});

const humanCalls = (f: Awaited<ReturnType<typeof fixture>>) => f.t.calls("thread.list").filter(c => (c.args as Record<string,unknown>).awaiting);
async function reread(f: Awaited<ReturnType<typeof fixture>>) {
  writable(f.data.threadList).value = { ...f.data.threadList.value, loading: true };
  writable(f.data.threadList).value = { ...f.data.threadList.value, loading: false, stale: false, loaded: true };
  await flush(); return humanCalls(f).at(-1)!;
}
it("replaces only a complete page, applies changed same-ID content and canonical order, accepts empty success", async () => {
  const f = await fixture(); await fill(f); const previous = f.inbox.items.value;
  const page = await reread(f); expect(f.inbox.items.value).toBe(previous); expect(f.inbox.loading.value).toBe(true);
  f.t.ok(page.id,{ items:[summary("a")] }); await flush(); expect(f.inbox.items.value).toBe(previous);
  f.t.ok(f.t.calls("thread.get").at(-1)!.id, details("a",{ awaiting_replies:[human("z"),{...human("h"),excerpt:"Updated h"}] })); await flush();
  expect(f.inbox.items.value.map(x => x.id)).toEqual(["z","h"]); expect(f.inbox.items.value[1]!.question).toBe("Updated h"); expect(f.inbox.loading.value).toBe(false);
  const empty = await reread(f); f.t.ok(empty.id,{items:[]}); await flush(); expect(f.inbox.items.value).toEqual([]); expect(f.inbox.stale.value).toBe(false); f.close();
});
it("detail error retains prior page and cancel is not an empty success", async () => {
  const f = await fixture(); await fill(f); const previous=f.inbox.items.value;
  const call=await reread(f); f.t.ok(call.id,{items:[summary("a")]}); await flush();
  f.t.ownerError(f.t.calls("thread.get").at(-1)!.id,"read_failed"); await flush(); expect(f.inbox.items.value).toBe(previous); expect(f.inbox.stale.value).toBe(true);
  const next=await reread(f); writable(f.data.threadList).value={...f.data.threadList.value,stale:true}; await flush(); expect(f.t.cancels()).toContain(next.id);
  f.t.ok(next.id,{items:[]}); await flush(); expect(f.inbox.items.value).toBe(previous); f.close();
});
it.each(["B","ABA","disconnect"])("clears owner-scoped actions immediately and ignores late same-ID response after %s",async transition=>{
  const f=await fixture(); await fill(f); const call=await reread(f);
  if(transition==="disconnect") f.t.drop();
  else { writable(f.data.owner).value=ownerB; if(transition==="ABA") writable(f.data.owner).value=connected; }
  expect(f.inbox.items.value).toEqual([]); expect((await f.inbox.answer("h","forbidden")).ok).toBe(false); expect(f.t.calls("message.reply")).toHaveLength(0);
  f.t.ok(call.id,{items:[summary("a")]}); await flush(); expect(f.inbox.items.value).toEqual([]); f.close();
});

it.each(["loading","success","error","finally"])("synchronous %s subscriber owner transition cannot revive old page/next detail",async boundary=>{
  const f=await fixture(); await fill(f); let once=false;
  const stop=effect(()=>{
    const loading=f.inbox.loading.value,items=f.inbox.items.value,error=f.inbox.error.value;
    const hit=boundary==="loading" ? loading : boundary==="success" ? items.some(x=>x.question==="new") : boundary==="error" ? !!error : !loading && items.some(x=>x.question==="new");
    if(!once && hit){once=true;writable(f.data.owner).value=ownerB;}
  });
  try{
    const count=f.t.calls("thread.get").length; const page=await reread(f);
    if(boundary==="loading"){expect(f.inbox.items.value).toEqual([]); expect(f.t.calls("thread.get")).toHaveLength(count);}
    else if(boundary==="error"){f.t.ownerError(page.id,"test_error");await flush();expect(f.inbox.items.value).toEqual([]);}
    else {f.t.ok(page.id,{items:[summary("a")]});await flush(); f.t.ok(f.t.calls("thread.get").at(-1)!.id,details("a",{awaiting_replies:[{...human("h"),excerpt:"new"}]}));await flush(); expect(f.inbox.items.value).toEqual([]);}
    expect(once).toBe(true);
  }finally{stop();f.close();}
});
it("observes disconnect/unknown then same owner within synchronous subscriber as a new epoch",async()=>{
  const f=await fixture();await fill(f);let once=false;
  const stop=effect(()=>{if(!once&&f.inbox.loading.value){once=true;f.t.drop();f.t.open();f.t.push({t:"hello",bridge_version:"test",data_dir:"/synthetic",owner:connected});}});
  try{await reread(f);expect(once).toBe(true);expect(f.inbox.items.value).toEqual([]);expect((await f.inbox.answer("h","no")).ok).toBe(false);expect(f.t.calls("message.reply")).toHaveLength(0);}finally{stop();f.close();}
});

it.each(["loading","success","error","finally"].flatMap(boundary=>["B","ABA","unknownSame","unchanged"].map(transition=>({boundary,transition}))))("AW1/R1 $boundary x $transition preserves only current owner facts",async({boundary,transition})=>{
 const f=await fixture();await fill(f);let hit=false;
 const stop=effect(()=>{
  const loading=f.inbox.loading.value,items=f.inbox.items.value,error=f.inbox.error.value;
  const ready=boundary==="loading"?loading:boundary==="success"?items.some(i=>i.question==="updated"):boundary==="error"?!!error:!loading&&items.some(i=>i.question==="updated");
  if(hit||!ready)return;hit=true;
  if(transition==="B")writable(f.data.owner).value=ownerB;
  else if(transition==="ABA"){f.t.push({t:"owner",event:"restarted",owner:ownerB});f.t.push({t:"owner",event:"restarted",owner:connected});}
  else if(transition==="unknownSame"){f.t.drop();f.t.open();f.t.push({t:"hello",bridge_version:"test",data_dir:"/synthetic",owner:connected});}
 });
 try{
  const previous=f.inbox.items.value;const page=await reread(f);
  if(boundary!=="loading"){
   if(boundary==="error")f.t.ownerError(page.id,"test_failure");
   else{f.t.ok(page.id,{items:[summary("a")]});await flush();f.t.ok(f.t.calls("thread.get").at(-1)!.id,details("a",{awaiting_replies:[{...human("h"),excerpt:"updated"}]}));}
  }
  await flush();expect(hit).toBe(true);
  if(transition!=="unchanged"){expect(f.inbox.items.value).toEqual([]);expect((await f.inbox.answer("h","not current")).ok).toBe(false);expect(f.t.calls("message.reply")).toHaveLength(0);}
  else if(boundary==="loading"||boundary==="error")expect(f.inbox.items.value).toBe(previous);
  else expect(f.inbox.items.value[0]!.question).toBe("updated");
 }finally{stop();f.close();}
});
it("same-session refresh notification reentry is finite and does not erase current page",async()=>{
 const f=await fixture();await fill(f);const previous=f.inbox.items.value;let once=false;
 const stop=effect(()=>{if(!once&&f.inbox.loading.value){once=true;writable(f.data.threadList).value={...f.data.threadList.peek(),loaded:true,loading:false,stale:false};}});
 try{await reread(f);expect(once).toBe(true);expect(f.inbox.items.value).toBe(previous);expect(humanCalls(f).length).toBeLessThanOrEqual(3);}finally{stop();f.close();}
});

it("revokes old-page action qualification before owner reset cancellation callbacks",async()=>{
 const f=await fixture();await fill(f);await reread(f);
 const cancel=(f.inbox as unknown as {cancel:{add(fn:()=>void):()=>void}}).cancel;
 let answer:ReturnType<typeof f.inbox.answer>|undefined;
 cancel.add(()=>{answer=f.inbox.answer("h","old-page callback");});
 writable(f.data.owner).value=ownerB;await flush();
 expect(answer).toBeDefined();expect(f.t.calls("message.reply")).toHaveLength(0);expect((await answer!).ok).toBe(false);f.close();
});

it.each(["B","ABA","unknownSame","query"])("cancelcallback answer admission is zero across %s",async transition=>{
 const f=await fixture();await fill(f);await reread(f);
 let result:ReturnType<typeof f.inbox.answer>|undefined;
 (f.inbox as unknown as {cancel:{add(fn:()=>void):void}}).cancel.add(()=>{result=f.inbox.answer("h","old callback");expect(f.t.calls("message.reply")).toHaveLength(0);});
 if(transition==="B")writable(f.data.owner).value=ownerB;
 else if(transition==="ABA"){f.t.push({t:"owner",event:"restarted",owner:ownerB});f.t.push({t:"owner",event:"restarted",owner:connected});}
 else if(transition==="unknownSame"){f.t.drop();f.t.open();f.t.push({t:"hello",bridge_version:"test",data_dir:"/synthetic",owner:connected});}
 else {const inbox=f.inbox as unknown as {loading:{value:boolean};nextCursor?:string;resetScope():void};inbox.resetScope();}
 await flush();expect(result).toBeDefined();expect((await result!).ok).toBe(false);expect(f.t.calls("message.reply")).toHaveLength(0);f.close();
});
it("same-session stale page remains authorized rather than globally disabling replies",async()=>{
 const f=await fixture();await fill(f);writable(f.data.threadList).value={...f.data.threadList.value,stale:true};
 const answer=f.inbox.answer("h","same scope");expect(f.t.calls("message.reply")).toHaveLength(1);
 f.t.ok(f.t.calls("message.reply")[0]!.id,{});await flush();
 const call=humanCalls(f).at(-1)!;f.t.ok(call.id,{items:[]});await flush();expect((await answer).ok).toBe(true);f.close();
});
it.each(["B","ABA","unknownSame","query"])("late answer retains original receipt but cannot refresh/cursor new %s scope",async transition=>{
 const f=await fixture();await fill(f);const answer=f.inbox.answer("h","original");const reply=f.t.calls("message.reply")[0]!;
 if(transition==="B")writable(f.data.owner).value=ownerB;
 else if(transition==="ABA"){f.t.push({t:"owner",event:"restarted",owner:ownerB});f.t.push({t:"owner",event:"restarted",owner:connected});}
 else if(transition==="unknownSame"){f.t.drop();f.t.open();f.t.push({t:"hello",bridge_version:"test",data_dir:"/synthetic",owner:connected});}
 else(f.inbox as unknown as {resetScope():void}).resetScope();
 await flush();const count=humanCalls(f).length;
 f.t.ownerError(reply.id,"delivery_unconfirmed");await flush();await answer;
 expect(humanCalls(f)).toHaveLength(count);expect(f.inbox.items.value).toEqual([]);expect(f.t.calls("message.reply")).toHaveLength(1);f.close();
});
it("cancel callback starts a fresh owner read without outer reset erasing its new page",async()=>{
 const f=await fixture();await fill(f);await reread(f);
 (f.inbox as unknown as {cancel:{add(fn:()=>void):void}}).cancel.add(()=>{f.t.push({t:"owner",event:"restarted",owner:ownerB});});
 writable(f.data.owner).value={state:"unknown"};await flush();
 writable(f.data.threadList).value={...f.data.threadList.value,loading:false,stale:false,loaded:true};await flush();
 const page=humanCalls(f).at(-1)!;f.t.ok(page.id,{items:[summary("fresh")]});await flush();
 f.t.ok(f.t.calls("thread.get").at(-1)!.id,details("fresh",{awaiting_replies:[human("new")] }));await flush();
 expect(f.inbox.items.value.map(x=>x.id)).toEqual(["new"]);f.close();
});
