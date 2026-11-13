import { describe, expect, it } from "vitest";
import { connected, flush, settle } from "../../data/test/harness";
import { fixtureModel, fixturePendingAdapter } from "./fixture";

describe("AppModel over the fake transport", () => {
  it("opens the newest Thread by default and shows only conversation rows", async () => {
    const { model } = await fixtureModel();
    expect(model.selectedId.value).toBe("lead");
    expect(model.conversation.value.map((r) => r.type)).toEqual(["message", "note", "note", "note", "note", "steps", "note", "note"]);
    expect(model.conversation.value.filter(row => row.type === "message").some(row => row.text.includes("cargo test"))).toBe(false);
    expect(model.context.value).toEqual({ inputTokens: 41200, autoSummaryAt: 200000 });
    expect(model.usage.value).toMatchObject({ cachedPercent: 75, attempts: 4 });
  });

  it("lists models and sends only this Thread's model settings, retaining the saved display on failure", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["thread.settings"] });
    const before = model.details.value!.model;
    model.openModelPicker();
    await settle(t, db);
    expect(model.modelPicker.value.models).toEqual(["mock-large", "mock-small"]);
    model.modelPicker.value = { ...model.modelPicker.value, model: "custom-id", effort: "high" };
    const save = model.saveThreadModel();
    await settle(t, db);
    await save;
    const call = t.calls("thread.set").at(-1)!;
    expect(call.args).toEqual({ thread_id: "lead", connection: model.details.value!.connection, model: "custom-id", effort: "high" });
    model.openModelPicker();
    await settle(t, db);
    const answer = db.answer.bind(db);
    db.answer = (c) => c.command === "thread.set" ? { ok: false, code: "invalid_argument", message: "Rejected" } : answer(c);
    model.modelPicker.value = { ...model.modelPicker.value, model: "bad-id" };
    const failed = model.saveThreadModel();
    await settle(t, db);
    await failed;
    expect(model.details.value!.model).toBe(before);
    expect(model.modelPicker.value.error).toContain("Rejected");
    model.dispose();
  });

  it("sends changed thread summary settings and the instruction reference only", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["thread.settings"] });
    model.openModelPicker();
    await settle(t, db);
    model.modelPicker.value = { ...model.modelPicker.value, autoCompactAt: "0", maxTokens: "4096", agents: "/tmp/AGENTS.md" };
    const saved = model.saveThreadModel();
    await settle(t, db);
    await saved;
    expect(t.calls("thread.set").at(-1)!.args).toMatchObject({ thread_id: "lead", auto_compact_at: "0", max_tokens: "4096", agents: "/tmp/AGENTS.md" });
    model.dispose();
  });

  it("does not write thread settings without the capability", async () => {
    const { model, t, db } = await fixtureModel();
    model.openModelPicker();
    await settle(t, db);
    await model.saveThreadModel();
    expect(t.calls("thread.set")).toHaveLength(0);
    model.dispose();
  });

  it("Monitor doesn't open any Thread until asked", async () => {
    const { model, t } = await fixtureModel({ route: "monitor" });
    expect(t.calls("history.list")).toHaveLength(0);
    expect(model.handle.value).toBeUndefined();
    expect(model.monitorRows.value[0]!.summary.thread_id).toBe("broken");
    model.monitorFilter.value = ["completed"];
    expect(model.monitorRows.value.map((r) => r.summary.thread_id)).toEqual(["done"]);
  });

  it("applies one monitor selection for state, pins, query and order", async () => {
    const { model } = await fixtureModel({ route: "monitor" });
    model.monitorPins.value = ["lead", "child"];
    model.monitorPinnedOnly.value = true;
    model.monitorQuery.value = "REVIEW";
    expect(model.monitorRows.value.map((r) => r.summary.thread_id)).toEqual(["child"]);
    model.monitorFilter.value = ["completed"];
    expect(model.monitorRows.value.map((r) => r.summary.thread_id)).toEqual(["child"]);
    model.monitorFilter.value = ["running"];
    expect(model.monitorRows.value.map((r) => r.summary.thread_id)).toEqual(["child"]);
    model.dispose();
  });

  it("keeps existing monitor rows in place across hints and appends new rows", async () => {
    const { model, t, db } = await fixtureModel({ route: "monitor" });
    const ids = () => model.monitorRows.value.map((row) => row.summary.thread_id);
    const before = ids();
    const reads = t.calls("thread.list").length;
    db.threads.lead = { ...db.threads.lead!, activity: "recovery", updated_at: "2099-01-01T00:00:00Z" };
    db.threads = Object.fromEntries(Object.entries(db.threads).reverse());
    db.threads["aaa-new"] = { ...db.threads.lead!, thread_id: "aaa-new", title: "New" };
    t.push({ t: "changed", thread_ids: [], list: true });
    await settle(t, db);
    expect(ids().slice(0, before.length)).toEqual(before);
    expect(ids().at(-1)).toBe("aaa-new");
    expect(model.counts.value.recovery).toBe(3);
    model.monitorFilter.value = ["recovery"];
    expect(ids()).toContain("lead");
    model.monitorFilter.value = [];
    expect(t.calls("thread.list").length).toBe(reads + 1);
    model.monitorSort.value = "recent";
    expect(ids()[0]).toBe("aaa-new");
    model.monitorSort.value = "stable";
    expect(ids().slice(0, before.length)).toEqual(before);
    model.dispose();
  });

  it("step facts come from shell.list and follow a change hint", async () => {
    const { model, t, db } = await fixtureModel();
    const step = () => {
      const row = model.conversation.value.find((r) => r.type === "steps");
      return row?.type === "steps" ? row.steps[0] : undefined;
    };
    expect(step()).toMatchObject({ status: "completed", exitCode: 0, durationMs: 2400 });
    db.shells.lead = [{ execution_id: "exec-1", state: "exited", exit_code: 3 }];
    t.push({ t: "changed", thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(step()).toMatchObject({ status: "failed", exitCode: 3 });
  });

  it("an open step re-reads output while its shell runs and once as it ends, then stops", async () => {
    const { model, t, db } = await fixtureModel();
    const hint = async () => {
      t.push({ t: "changed", thread_ids: ["lead"], list: false });
      await settle(t, db);
    };
    db.shells.lead = [{ execution_id: "exec-1", state: "running" }];
    await hint();
    const stop = model.watchOutput("exec-1");
    await settle(t, db);
    expect(model.outputs.value.get("exec-1")?.text).toContain("12 passed");
    const reads = () => t.calls("shell.read").length;
    let before = reads();
    await hint();
    expect(reads()).toBeGreaterThan(before);
    db.shells.lead = [{ execution_id: "exec-1", state: "exited", exit_code: 0 }];
    before = reads();
    await hint();
    expect(reads()).toBeGreaterThan(before);
    before = reads();
    await hint();
    expect(reads()).toBe(before);
    stop();
    db.shells.lead = [{ execution_id: "exec-1", state: "running" }];
    await hint();
    expect(reads()).toBe(before);
  });

  it("send: nothing optimistic, state clears on acceptance", async () => {
    const { model, t } = await fixtureModel();
    const sent = model.send("hello");
    expect(model.sendState.value.kind).toBe("sending");
    await flush();
    const call = t.calls("message.send")[0]!;
    expect(call.args).toEqual({ thread_id: "lead", text: "hello" });
    const rowsBefore = model.conversation.value.length;
    t.ok(call.id, { message_id: "m", thread_id: "lead" });
    expect(await sent).toBe(true);
    expect(model.sendState.value.kind).toBe("idle");
    expect(model.conversation.value.length).toBe(rowsBefore);
  });

  it("a lost reply is unconfirmed; resending reuses the operation id", async () => {
    const { model, t, db } = await fixtureModel();
    const sent = model.send("hello");
    await flush();
    const first = t.calls("message.send")[0]!;
    db.answered.add(first.id);
    t.drop();
    expect(await sent).toBe(false);
    expect(model.sendState.value).toMatchObject({ kind: "unconfirmed", text: "hello" });
    t.open();
    t.push({t:"hello",bridge_version:"0.0.1",data_dir:"/temp/owner-a",owner:connected});
    await settle(t,db);
    expect(model.pendingOwnMessage.peek()).toBeDefined();
    expect(model.sendState.peek().kind).toBe("unconfirmed");
    expect(await model.send("must not replace uncertain text")).toBe(false);
    expect(model.pendingOwnMessage.peek()?.operationId).toBe(first.operation_id);
    const again = model.resend();
    await flush();
    const second = t.calls("message.send")[1]!;
    expect(second.operation_id).toBe(first.operation_id);
    t.ok(second.id, {message_id:"confirmed-original",thread_id:"lead"});
    expect(await again).toBe(true);
  });

  it("an owner error on send is reported and the text is not considered sent", async () => {
    const { model, t } = await fixtureModel();
    const sent = model.send("hello");
    await flush();
    t.ownerError(t.calls("message.send")[0]!.id, "busy_thread", "the thread is busy");
    expect(await sent).toBe(false);
    expect(model.sendState.value).toEqual({ kind: "failed", message: "the thread is busy" });
  });

  it("stop uses the open Run; retry reads the Thread's Run first", async () => {
    const { model, t, db } = await fixtureModel();
    expect(model.canStop.value).toBe(true);
    const stopped = model.stop();
    await flush();
    const stop = t.calls("run.stop")[0]!;
    expect(stop.args).toEqual({ run_id: "run-1" });
    t.ok(stop.id, {});
    await stopped;
    const retried = model.retry("broken");
    await flush();
    db.answered.add(t.calls("run.stop")[0]!.id);
    await settle(t, db);
    await retried;
    expect(t.calls("run.retry")[0]!.args).toEqual({ run_id: "run-2" });
  });

  it("a failed action says which one and why", async () => {
    const { model, t } = await fixtureModel();
    const archived = model.archive("done");
    await flush();
    t.ownerError(t.calls("thread.archive")[0]!.id, "not_found", "no such thread");
    await archived;
    expect(model.actionError.value).toBe("Archive failed: no such thread");
  });

  it("recovery shows the owner's reason only in that state", async () => {
    const { model, t, db } = await fixtureModel();
    expect(model.recovery.value).toBeUndefined();
    model.openThread("broken");
    await settle(t, db);
    expect(model.recovery.value?.message).toBe("provider: connection interrupted");
    expect(model.canRetry.value).toBe(true);
  });

  it("switching Threads closes the old one: one watch at a time from this view", async () => {
    const { model, t, db } = await fixtureModel();
    model.openThread("broken");
    await settle(t, db);
    await flush();
    expect(t.watches().at(-1)).toMatchObject({ thread_ids: ["broken"], list: true });
  });

  it("the connection view distinguishes owner down from a browser the bridge refuses", async () => {
    const { model, t } = await fixtureModel();
    expect(model.connection.value).toBe("connected");
    t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } });
    expect(model.connection.value).toBe("ownerDown");
    t.drop();
    expect(model.connection.value).toBe("connecting");
    t.handlers!.onClose();
    expect(model.connection.value).toBe("authNeeded");
  });

  it("pending items come only from the adapter and mark their Thread", async () => {
    const empty = await fixtureModel();
    expect(empty.model.pendingCount.value).toBe(0);
    expect(empty.model.counts.value.awaiting).toBeUndefined();
    const { model } = await fixtureModel({ pending: fixturePendingAdapter() });
    expect(model.pendingCount.value).toBe(2);
    expect(model.counts.value.awaiting).toBe(2);
  });

  it("the live preview signal stays connected to the data layer's live frames", async () => {
    const { model, t } = await fixtureModel();
    t.push({ t: "live", thread_id: "lead", attempt_id: "a1", gap: false, deltas: [{ offset: 0, reasoning: false, text: "partial" }] });
    await flush();
    expect(model.handle.value!.preview.value).toMatchObject({ kind: "live", text: "partial", attemptId: "a1" });
  });

  it("leaving the Conversation stops reading its Thread and reopening uses the positional API", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["history.window"] });
    const reads = () => t.calls("history.window").length;
    model.applyRoute({ view: "monitor" });
    await flush();
    expect(t.watches().at(-1)!.thread_ids).toEqual([]);
    const away = reads();
    t.push({ t: "changed", thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(reads()).toBe(away);
    expect(model.longReader.value).toBeUndefined(); // History is not read or retained off the Conversation route.
    model.applyRoute({ view: "conversation", threadId: "lead" });
    await settle(t, db);
    expect(t.watches().at(-1)!.thread_ids).toEqual(["lead"]);
    expect(reads()).toBeGreaterThan(away);
    expect(model.longReader.value?.acceptedView.peek().rows.length).toBeGreaterThan(0);
    expect(t.calls("history.list")).toHaveLength(0);
  });

  it("switching Thread cancels the old one's current-window reads and closing a step cancels its output read", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["history.window"] });
    const stop = model.watchOutput("exec-1");
    await flush();
    const read = t.calls("shell.read").at(-1)!;
    stop();
    await flush();
    expect(t.cancels()).toContain(read.id);
    db.answered.add(read.id);
    expect(model.outputs.value.has("exec-1")).toBe(false);
    model.openThread("broken");
    await flush();
    const sent = t.calls("history.window").at(-1)!;
    model.openThread("lead");
    await flush();
    expect(t.cancels()).toContain(sent.id);
    db.answered.add(sent.id);
    await settle(t, db);
    expect(model.selectedId.value).toBe("lead");
    expect(model.conversation.value.length).toBeGreaterThan(0);
  });
});


describe("per-thread reply duties", () => {
  it("shows human and thread duties, answers only a human, and refreshes on a hint", async () => {
    const { model, t, db } = await fixtureModel({ configure: (db) => {
      Object.assign(db.details.lead!, { awaiting_replies: [
        { message_id: "h", recipient_kind: "human", excerpt: "Choose", delivery_status: "pending" },
        { message_id: "t", recipient_kind: "thread", recipient_thread_id: "child", excerpt: "Review", delivery_status: "applied" },
      ] });
    } });
    expect(model.threadReplies.value.map((r) => r.recipient.kind)).toEqual(["human", "thread"]);
    expect(await model.answerReply("t", "no")).toBe("not available");
    const answer = model.answerReply("h", "yes");
    await flush();
    const call = t.calls("message.reply").at(-1)!;
    expect(call.args).toEqual({ message_id: "h", text: "yes" });
    t.ok(call.id, {}); expect(await answer).toBeUndefined();
    Object.assign(db.details.lead!, { awaiting_replies: [] });
    t.push({ t: "changed", thread_ids: ["lead"], list: false }); await settle(t, db);
    expect(model.threadReplies.value).toEqual([]);
    expect(model.pending.items.value).toEqual([]);
    model.dispose();
  });
});

it("output first load is loading, unchanged refresh is silent and real changes still replace", async () => {
  const { model, t, db } = await fixtureModel();
  const stop = model.watchOutput("exec-1"); await flush();
  expect(model.outputs.peek().get("exec-1")?.loading).toBe(true);
  let read = t.calls("shell.read").at(-1)!; db.answered.add(read.id); t.ok(read.id, { execution_id: "exec-1", text: "" }); await flush();
  const saved = model.outputs.peek().get("exec-1");
  const refresh = model.watchOutput("exec-1"); await flush(); expect(model.outputs.peek().get("exec-1")).toBe(saved);
  refresh(); await flush(); expect(model.outputs.peek().get("exec-1")).toBe(saved);
  const next = model.watchOutput("exec-1"); await flush(); read = t.calls("shell.read").at(-1)!; db.answered.add(read.id);
  t.ok(read.id, { execution_id: "exec-1", text: "new synthetic output" }); await flush();
  expect(model.outputs.peek().get("exec-1")?.text).toBe("new synthetic output"); expect(model.outputs.peek().get("exec-1")).not.toBe(saved);
  next(); stop(); model.dispose();
});

it('reservation notification is synchronous, owns text/op before dispatch and isolates observer throws',async()=>{
 const f=await fixtureModel();
 try{
  let notified=0;
  const sent=f.model.send('Reserved draft',()=>{
   notified++;expect(f.model.pendingOwnMessage.peek()).toMatchObject({text:'Reserved draft',phase:'sending'});
   expect(f.model.sendState.peek().kind).toBe('sending');expect(f.t.calls('message.send')).toHaveLength(0);
   throw new Error('UI observer failed');
  });
  expect(notified).toBe(1);await flush();const call=f.t.calls('message.send').at(-1)!;
  f.t.ok(call.id,{message_id:'accepted',thread_id:'lead'});expect(await sent).toBe(true);expect(notified).toBe(1);
  expect(await f.model.send(' ',()=>{notified++;})).toBe(false);expect(notified).toBe(1);
 }finally{f.model.dispose();f.data.stop();}
});
it('reservation reentrant route loss prevents dispatch and preserves the owned original draft',async()=>{
 const f=await fixtureModel();
 try{
  const sent=f.model.send('Owned before route change',()=>{f.model.route.value={view:'apps'};});
  expect(await sent).toBe(false);expect(f.t.calls('message.send')).toHaveLength(0);
  // Route disposal may remove that scope; it must never dispatch the old mutation.
  const pending=f.model.pendingOwnMessage.peek();if(pending)expect(pending).toMatchObject({text:'Owned before route change',phase:'failed'});
 }finally{f.model.dispose();f.data.stop();}
});

it('publishes accepted ownership and pending removal in one ACK frame for the exact original operation',async()=>{
 const f=await fixtureModel();const frames:{accepted:number;pending:boolean;rows:number;phase:string}[]=[];
 const scope=f.model.ownMutationScope();
 const capture=()=>frames.push({accepted:f.model.acceptedOwnMessages.peek().length,pending:!!f.model.pendingOwnMessage.peek(),rows:f.model.ownMutationRows(scope).length,phase:f.model.sendState.peek().kind});
 const stopAccepted=f.model.acceptedOwnMessages.subscribe(capture),stopPending=f.model.pendingOwnMessage.subscribe(capture);
 try{
  const sent=f.model.send('Original owned draft');await flush();const call=f.t.calls('message.send').at(-1)!;
  expect(frames.some(frame=>frame.pending&&frame.accepted===0)).toBe(true);
  f.t.ok(call.id,{thread_id:'lead',message_id:'exact-saved-node'});expect(await sent).toBe(true);
  expect(frames.some(frame=>frame.pending&&frame.accepted>0)).toBe(false);
  expect(frames.filter(frame=>frame.accepted>0).every(frame=>frame.rows===1&&frame.phase==='idle')).toBe(true);
  expect(f.model.acceptedOwnMessages.peek()[0]).toMatchObject({operationId:call.operation_id,messageId:'exact-saved-node',text:'Original owned draft'});
 }finally{stopAccepted();stopPending();f.model.dispose();f.data.stop();}
});
it.each(['reserve-next','invalidate-route','invalidate-owner'] as const)('ACK subscribers see a complete ownership commit before synchronous %s reentry',async mode=>{
 const f=await fixtureModel();let entered=false,observed:unknown,next:Promise<boolean>|undefined;
 let operation=0;f.model.ops.mutationId=()=>`i1:reentry-${++operation}`;
 const stop=f.model.acceptedOwnMessages.subscribe(rows=>{
  if(!rows.length||entered)return;entered=true;
  observed={pending:f.model.pendingOwnMessage.peek(),phase:f.model.sendState.peek().kind};
  if(mode==='reserve-next')next=f.model.send('Next original operation');
  else if(mode==='invalidate-route')f.model.navigate({view:'threads'});
  else {const owner=f.data.owner.peek();if(owner.state==='connected')f.t.push({t:'owner',event:'connected',owner:{...owner,info:{...owner.info,instance_id:'replacement-owner'}}});}
 });
 try{
  const sent=f.model.send('First original operation');await flush();const first=f.t.calls('message.send').at(-1)!;
  f.t.ok(first.id,{thread_id:'lead',message_id:'first-exact-node'});await sent;await flush();
  expect(observed).toEqual({pending:undefined,phase:'idle'});
  if(mode==='reserve-next'){
   const second=f.t.calls('message.send').at(-1)!;expect(second.operation_id).not.toBe(first.operation_id);
   expect(f.model.pendingOwnMessage.peek()?.text).toBe('Next original operation');expect(f.model.sendState.peek().kind).toBe('sending');
   f.t.ownerError(second.id,'temporary_failure');await next;
  }else expect(f.t.calls('message.send')).toHaveLength(1);
 }finally{stop();f.model.dispose();f.data.stop();}
});
