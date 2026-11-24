import { effect, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { describe, expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { Cancel } from "../src/operations";
import { HumanInbox, HUMAN_PAGE_LIMIT } from "../src/human-inbox";
import { FakeTransport, connected, flush, summary } from "./harness";

const writable = <T>(s: ReadonlySignal<T>): Signal<T> => s as Signal<T>;
const ownerB = { ...connected, info: { ...(connected.state === "connected" ? connected.info : {}), instance_id: "owner-b" } } as typeof connected;

async function fixture() {
  const t = new FakeTransport(); let seq = 0;
  // #96 row reads (active `status`, `thread.list(thread_ids)`) and the #126 Archive band page are not under test here; answer them so they free their slots.
  t.onCall = c => { if (c.command === "status" || (c.command === "thread.list" && ((c.args as { thread_ids?: string[] }).thread_ids || (c.args as { archived?: string }).archived === "only"))) queueMicrotask(() => { if (t.handlers) t.ok(c.id, { items: [] }); }); };
  const data = new ShellboyData({ transport: t, newId: () => `uuid-${++seq}` });
  // The Cancel of each human-page read, as the shared page owner hands it to the operation.
  const reads: Cancel[] = []; const messageList = data.operations.messageList.bind(data.operations);
  data.operations.messageList = (args, cursor, read) => { if ("to" in args && read?.cancel) reads.push(read.cancel); return messageList(args, cursor, read); };
  const inbox = new HumanInbox(data); const list = data.trackThreadList(); data.start(); t.open();
  t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  await flush(); t.ok(t.calls("thread.list").find(c => !(c.args as Record<string, unknown>).awaiting)!.id, { items: [] }); await flush();
  const close = () => { inbox.close(); list.close(); data.stop(); };
  return { t, data, inbox, close, lastRead: () => reads.at(-1)! };
}
const human = (id: string, thread = "a") => ({ message_id: id, asked_by: thread, sender: { kind: "model", thread_id: thread }, recipient: { kind: "name", name: "human" }, excerpt: `Question ${id}`, created_at: "2026-01-01T00:00:00Z" });
async function fill(f: Awaited<ReturnType<typeof fixture>>, cursor?: string) {
  const list = f.t.calls("message.list").at(-1)!;
  expect(list.args).toEqual({ to: "human", limit: HUMAN_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
  f.t.ok(list.id, { items: [human("h")], next_cursor: "next-key" }); await flush();
}
describe("bounded named reply inbox", () => {
  it("refreshes its global page on a list hint without Thread detail fan-out", async () => {
    const f = await fixture();
    await fill(f);
    const before = f.t.calls("message.list").length;
    f.t.push({ t: "changed", thread_ids: ["unrelated-thread"], list: true, config_changed: false });
    await flush();
    expect(f.t.calls("message.list").length).toBeGreaterThan(before);
    const threadList = f.t.calls("thread.list").at(-1)!;
    f.t.ok(threadList.id, { items: [] });
    await flush();
    const latest = f.t.calls("message.list").at(-1)!;
    expect(latest.args).toEqual({ to: "human", limit: HUMAN_PAGE_LIMIT });
    expect(f.t.calls("thread.get")).toHaveLength(0);
    f.t.ok(latest.id, { items: [] });
    await flush();
    expect(f.inbox.items.value).toEqual([]);
    f.close();
  });
  it.each([0, 1500])("reads two cross-Thread pages and no Thread details with %i known Threads", async count => {
    const f = await fixture();
    try {
      await fill(f);
      const more = f.inbox.more(); await flush(); await fill(f, "next-key"); await more;
      expect(f.t.calls("message.list")).toHaveLength(2);
      expect(f.t.calls("thread.get")).toHaveLength(0);
    } finally { f.close(); }
  });
  it("cancels one displayed human question and removes it only on the next owner hint", async () => {
    const f = await fixture();
    try {
      await fill(f);
      expect((await f.inbox.cancel("other")).ok).toBe(false);
      const canceled = f.inbox.cancel("h");
      const call = f.t.calls("message.cancel")[0]!;
      expect(call.args).toEqual({ message_ids: ["h"] });
      f.t.ok(call.id, { items: [{ message_id: "h", outcome: "cancelled", archive_draft_id: "archive-h" }] });
      expect((await canceled).ok).toBe(true);
      expect(f.inbox.items.value.map(row => row.id)).toEqual(["h"]);
      expect(f.t.calls("message.list")).toHaveLength(1);
      const refresh = await reread(f);
      f.t.ok(refresh.id, { items: [] }); await flush();
      expect(f.inbox.items.value).toEqual([]);
    } finally { f.close(); }
  });
  it("reads only its named page, preserves creation time and keysets", async () => {
    const f = await fixture(); await fill(f);
    expect(f.inbox.items.value).toEqual([{ id: "h", threadId: "a", question: "Question h", askedAt: "2026-01-01T00:00:00Z" }]);
    expect(f.t.calls("thread.get")).toHaveLength(0);
    const more = f.inbox.more(); await flush(); await fill(f, "next-key"); await more;
    expect(f.t.calls("message.list")).toHaveLength(2);
    expect(f.t.calls("thread.get")).toHaveLength(0);
    f.close();
  });
  it("never sends reply for an unrelated/Thread duty, and coalesces double clicks", async () => {
    const f = await fixture(); await fill(f);
    expect((await f.inbox.answer("q", "no")).ok).toBe(false);
    const first = f.inbox.answer("h", "answer"), duplicate = f.inbox.answer("h", "answer"); await flush();
    expect(f.t.calls("message.reply")).toHaveLength(1);
    const reply = f.t.calls("message.reply")[0]!; expect(reply.args).toEqual({ message_id: "h", text: "answer" });
    f.t.ok(reply.id, {}); await first; expect(f.t.calls("message.list")).toHaveLength(1); const list = await reread(f); f.t.ok(list.id, { items: [] }); await flush();
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
    expect(resent.operation_id).toBe(sent.operation_id); f.t.ok(resent.id, {}); await flush(); f.t.ok(f.t.calls("message.list").at(-1)!.id, { items: [] }); await retry; f.close();
  });
  it("reports expired cursors instead of silently scanning/restarting, keeps the loaded questions, and cancels on close", async () => {
    const f = await fixture(); await fill(f); const more = f.inbox.more(); await flush();
    const list = f.t.calls("message.list").at(-1)!; f.t.ownerError(list.id, "cursor_expired"); await more;
    expect(f.inbox.error.value).toMatchObject({ code: "cursor_expired" }); expect(f.inbox.items.value.map(i => i.id)).toEqual(["h"]);
    expect(f.inbox.hasMore.value).toBe(false); expect(f.t.calls("message.list")).toHaveLength(2); f.close();
  });
});

it("invalidates a stale read before it can publish, keeps unrelated list facts and cancels reads on shutdown", async () => {
  const f = await fixture(); const before = f.data.threadList.value;
  const call = f.t.calls("message.list").at(-1)!;
  f.inbox.close(); await flush(); expect(f.t.cancels()).toContain(call.id);
  f.t.ok(call.id, { items: [summary("unrelated")] }); await flush();
  expect(f.inbox.items.value).toEqual([]); expect(f.data.threadList.value).toEqual(before); f.close();
});

it("fails loud for oversized pages without scanning detail records", async () => {
  const f = await fixture(); const call = f.t.calls("message.list").at(-1)!;
  f.t.ok(call.id, { items: Array.from({ length: HUMAN_PAGE_LIMIT + 1 }, (_, i) => summary(String(i))) }); await flush();
  expect(f.inbox.error.value?.kind).toBe("invalid_response"); expect(f.t.calls("thread.get")).toHaveLength(0); f.close();
});

it("retains displayed questions during same-owner list invalidation and failed reread", async () => {
  const f = await fixture(); await fill(f); const previous = f.inbox.items.value;
  expect(f.inbox.items.value).toBe(previous);
  const call = await reread(f);
  f.t.ownerError(call.id,"temporarily_unavailable"); await flush();
  expect(f.inbox.items.value).toBe(previous); expect(f.inbox.error.value).toBeDefined(); f.close();
});

const humanCalls = (f: Awaited<ReturnType<typeof fixture>>) => f.t.calls("message.list");
async function reread(f: Awaited<ReturnType<typeof fixture>>) {
  f.t.push({ t: "changed", thread_ids: [], list: true, config_changed: false });
  await flush(); return humanCalls(f).at(-1)!;
}
it("replaces only a complete page, applies changed same-ID content and canonical order, accepts empty success", async () => {
  const f = await fixture(); await fill(f); const previous = f.inbox.items.value;
  const page = await reread(f); expect(f.inbox.items.value).toBe(previous); expect(f.inbox.loading.value).toBe(true);
  f.t.ok(page.id,{ items:[human("z"),{...human("h"),excerpt:"Updated h"}] }); await flush();
  expect(f.inbox.items.value.map(x => x.id)).toEqual(["z","h"]); expect(f.inbox.items.value[1]!.question).toBe("Updated h"); expect(f.inbox.loading.value).toBe(false);
  const empty = await reread(f); f.t.ok(empty.id,{items:[]}); await flush(); expect(f.inbox.items.value).toEqual([]); expect(f.inbox.stale.value).toBe(false); f.close();
});
it("page error retains prior page and cancel is not an empty success", async () => {
  const f = await fixture(); await fill(f); const previous=f.inbox.items.value;
  const call=await reread(f); f.t.ownerError(call.id,"read_failed"); await flush(); expect(f.inbox.items.value).toBe(previous); expect(f.inbox.stale.value).toBe(true);
  const next=await reread(f); f.lastRead().cancel(); await flush(); expect(f.t.cancels()).toContain(next.id);
  expect(f.inbox.loading.value).toBe(false); expect(f.inbox.error.value).toMatchObject({ code: "read_failed" });
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
    else {f.t.ok(page.id,{items:[{...human("h"),excerpt:"new"}]});await flush(); expect(f.inbox.items.value).toEqual([]);}
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
   else{f.t.ok(page.id,{items:[{...human("h"),excerpt:"updated"}]});}
  }
  await flush();expect(hit).toBe(true);
  if(transition!=="unchanged"){expect(f.inbox.items.value).toEqual([]);expect((await f.inbox.answer("h","not current")).ok).toBe(false);expect(f.t.calls("message.reply")).toHaveLength(0);}
  else if(boundary==="loading"||boundary==="error")expect(f.inbox.items.value).toBe(previous);
  else expect(f.inbox.items.value[0]!.question).toBe("updated");
 }finally{stop();f.close();}
});
it("coalesces hints during a page reread and keeps loadingMore specific to append", async () => {
  const f = await fixture(); await fill(f);
  expect(f.inbox.loadingMore.value).toBe(false);
  const previous = f.inbox.items.value;
  const first = await reread(f);
  expect(f.inbox.loading.value).toBe(true);
  expect(f.inbox.loadingMore.value).toBe(false);
  for (let i = 0; i < 3; i++) {
    f.t.push({ t: "changed", thread_ids: [], list: true, config_changed: false });
    await flush();
  }
  expect(humanCalls(f)).toHaveLength(2);
  expect(f.inbox.items.value).toBe(previous);
  f.t.ok(first.id, { items: [human("h2"), human("h")], next_cursor: "next-key" }); await flush();
  expect(humanCalls(f)).toHaveLength(3);
  expect(f.inbox.items.value.map(item => item.id)).toEqual(["h2", "h"]);
  expect(f.inbox.loading.value).toBe(true);
  expect(f.inbox.loadingMore.value).toBe(false);
  const rerun = humanCalls(f).at(-1)!;
  f.t.ok(rerun.id, { items: [human("h2"), human("h")], next_cursor: "next-key" }); await flush();
  expect(f.inbox.loading.value).toBe(false);
  expect(f.inbox.items.value.map(item => item.id)).toEqual(["h2", "h"]);

  const more = f.inbox.more(); await flush();
  expect(f.inbox.loadingMore.value).toBe(true);
  const append = humanCalls(f).at(-1)!;
  f.t.ok(append.id, { items: [human("h3")] }); await more;
  expect(f.inbox.loadingMore.value).toBe(false);
  expect(f.inbox.items.value.map(item => item.id)).toEqual(["h2", "h", "h3"]);
  f.close();
});

it("same-session refresh notification reentry is finite and does not erase current page",async()=>{
 const f=await fixture();await fill(f);const previous=f.inbox.items.value;let once=false;
 const stop=effect(()=>{if(!once&&f.inbox.loading.value)once=true;});
 try{await reread(f);expect(once).toBe(true);expect(f.inbox.items.value).toBe(previous);expect(humanCalls(f).length).toBeLessThanOrEqual(3);}finally{stop();f.close();}
});

it("revokes old-page action qualification before owner reset cancellation callbacks",async()=>{
 const f=await fixture();await fill(f);await reread(f);
 const cancel=f.lastRead();
 let answer:ReturnType<typeof f.inbox.answer>|undefined;
 cancel.add(()=>{answer=f.inbox.answer("h","old-page callback");});
 writable(f.data.owner).value=ownerB;await flush();
 expect(answer).toBeDefined();expect(f.t.calls("message.reply")).toHaveLength(0);expect((await answer!).ok).toBe(false);f.close();
});

it.each(["B","ABA","unknownSame","query"])("cancelcallback answer admission is zero across %s",async transition=>{
 const f=await fixture();await fill(f);await reread(f);
 let result:ReturnType<typeof f.inbox.answer>|undefined;
 f.lastRead().add(()=>{result=f.inbox.answer("h","old callback");expect(f.t.calls("message.reply")).toHaveLength(0);});
 if(transition==="B")writable(f.data.owner).value=ownerB;
 else if(transition==="ABA"){f.t.push({t:"owner",event:"restarted",owner:ownerB});f.t.push({t:"owner",event:"restarted",owner:connected});}
 else if(transition==="unknownSame"){f.t.drop();f.t.open();f.t.push({t:"hello",bridge_version:"test",data_dir:"/synthetic",owner:connected});}
 else {const inbox=f.inbox as unknown as {resetScope():void};inbox.resetScope();}
 await flush();expect(result).toBeDefined();expect((await result!).ok).toBe(false);expect(f.t.calls("message.reply")).toHaveLength(0);f.close();
});
it("same-session stale page remains authorized rather than globally disabling replies",async()=>{
 const f=await fixture();await fill(f);
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
 f.lastRead().add(()=>{f.t.push({t:"owner",event:"restarted",owner:ownerB});});
 writable(f.data.owner).value={state:"unknown"};await flush();
 const page=humanCalls(f).at(-1)!;f.t.ok(page.id,{items:[human("new", "fresh")]});await flush();
 expect(f.inbox.items.value.map(x=>x.id)).toEqual(["new"]);f.close();
});

it("page-two answer waits for a hint, which re-reads from the first page",async()=>{
 const f=await fixture();await flush();f.t.ok(humanCalls(f).at(-1)!.id,{items:[human("h", "a")],next_cursor:"page-two"});await flush();const more=f.inbox.more();await flush();
 f.t.ok(humanCalls(f).at(-1)!.id,{items:[human("second-id", "second")]});await more;
 const before=humanCalls(f).length;const answer=f.inbox.answer("second-id","ok");f.t.ok(f.t.calls("message.reply").at(-1)!.id,{});await flush();
 expect(humanCalls(f)).toHaveLength(before); await reread(f); expect(humanCalls(f)).toHaveLength(before+1);expect((humanCalls(f).at(-1)!.args as Record<string,unknown>).cursor).toBeUndefined();
 f.t.ok(humanCalls(f).at(-1)!.id,{items:[]});await flush();await answer;f.close();
});
it("explicit same-owner reconnect retry dispatches a new call with the ORIGINAL operation ID",async()=>{
 const f=await fixture();await fill(f);const answer=f.inbox.answer("h","exact text");const original=f.t.calls("message.reply").at(-1)!;
 f.t.drop();await flush();await answer;f.t.open();f.t.push({t:"hello",bridge_version:"test",data_dir:"/synthetic",owner:connected});
 await flush();await fill(f);
 const before=f.t.calls("message.reply").length;const retry=f.inbox.answer("h","exact text");await flush();
 expect(f.t.calls("message.reply")).toHaveLength(before+1);const next=f.t.calls("message.reply").at(-1)!;expect(next.id).not.toBe(original.id);expect(next.operation_id).toBe(original.operation_id);expect(next.args).toEqual(original.args);
 f.t.ownerError(next.id,"delivery_unconfirmed");await flush();f.t.ok(humanCalls(f).at(-1)!.id,{items:[]});await flush();await retry;f.close();
});
it.each(["owner","query"])("page-two completion reset callback %s change cannot be recaptured as a fresh first-page intent",async transition=>{
 const f=await fixture();await flush();f.t.ok(humanCalls(f).at(-1)!.id,{items:[human("h", "a")],next_cursor:"p2"});await flush();
 const more=f.inbox.more();await flush();f.t.ok(humanCalls(f).at(-1)!.id,{items:[human("h", "a")]});await more;
 const answer=f.inbox.answer("h","text");const reply=f.t.calls("message.reply").at(-1)!;
 f.lastRead().add(()=>{if(transition==="owner"){writable(f.data.owner).value=ownerB;}else(f.inbox as unknown as {resetScope():void}).resetScope();});
 const before=humanCalls(f).length;f.t.ok(reply.id,{});await flush();await answer;expect(humanCalls(f)).toHaveLength(before);expect(f.t.calls("message.reply")).toHaveLength(1);f.close();
});
it("different owner cannot reuse or remint an unconfirmed original-owner receipt",async()=>{
 const f=await fixture();await fill(f);const answer=f.inbox.answer("h","same text");const original=f.t.calls("message.reply").at(-1)!;
 writable(f.data.owner).value=ownerB;f.t.ownerError(original.id,"delivery_unconfirmed");await flush();await answer;
 const result=await f.inbox.answer("h","same text");expect(result.ok).toBe(false);expect(f.t.calls("message.reply")).toHaveLength(1);f.close();
});

it("keeps empty status unconfirmed after owner restart until a new validated page", async () => {
  const f = await fixture(); await fill(f);
  f.t.push({ t: "owner", event: "restarted", owner: connected }); await flush();
  expect(f.inbox.items.peek()).toEqual([]);
  expect(f.inbox.loading.peek() || f.inbox.stale.peek()).toBe(true);
  expect((await f.inbox.answer("h", "must not send")).ok).toBe(false);
  expect(f.t.calls("message.reply")).toHaveLength(0);
  const page = humanCalls(f).at(-1)!; f.t.ok(page.id, { items: [] }); await flush();
  expect(f.inbox.items.peek()).toEqual([]); expect(f.inbox.loading.peek()).toBe(false); expect(f.inbox.stale.peek()).toBe(false);
  f.close();
});

for (const transition of ["unknown-same", "ABA"] as const) it(`confirms empty only after validated new page following ${transition}`, async () => {
  const f = await fixture(); await fill(f);
  if (transition === "unknown-same") f.t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } });
  else f.t.push({ t: "owner", event: "restarted", owner: ownerB });
  f.t.push({ t: "owner", event: "restarted", owner: connected }); await flush();
  expect(f.inbox.items.peek()).toEqual([]); expect(f.inbox.stale.peek() || f.inbox.loading.peek()).toBe(true);
  const failed = humanCalls(f).at(-1)!; f.t.ownerError(failed.id, "temporarily_unavailable"); await flush();
  expect(f.inbox.stale.peek()).toBe(true); expect((await f.inbox.answer("h", "no")).ok).toBe(false);
  const page = await reread(f); f.t.ok(page.id, { items: [] }); await flush();
  expect(f.inbox.stale.peek()).toBe(false); expect(f.inbox.items.peek()).toEqual([]); expect(f.t.calls("message.reply")).toHaveLength(0); f.close();
});
it("new scope is unconfirmed before an old read cancellation callback can inspect it", async () => {
  const f = await fixture(); await fill(f); const original = f.data.operations.messageList.bind(f.data.operations); let observed: boolean | undefined;
  f.data.operations.messageList = (args, cursor, read) => {
    if ("to" in args) read?.cancel?.add(() => { observed = f.inbox.stale.peek() && f.inbox.items.peek().length === 0; });
    return original(args, cursor, read);
  };
  const page = await reread(f); f.t.push({ t: "owner", event: "restarted", owner: connected }); await flush();
  expect(observed).toBe(true); expect(f.inbox.stale.peek()).toBe(true);
  f.t.ok(page.id, { items: [] }); await flush(); expect(f.inbox.stale.peek()).toBe(true); f.close();
});
