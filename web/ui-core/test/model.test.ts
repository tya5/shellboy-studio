import { describe, expect, it } from "vitest";
import { flush, settle } from "../../data/test/harness";
import { fixtureModel, fixturePendingAdapter } from "./fixture";

describe("AppModel over the fake transport", () => {
  it("opens the newest Thread by default and shows only conversation rows", async () => {
    const { model } = await fixtureModel();
    expect(model.selectedId.value).toBe("lead");
    expect(model.conversation.value.map((r) => r.type)).toEqual(["message", "message", "steps", "message"]);
    expect(model.context.value).toEqual({ inputTokens: 41200, autoSummaryAt: 200000 });
    expect(model.usage.value).toMatchObject({ cachedPercent: 75, attempts: 4 });
  });

  it("Monitor doesn't open any Thread until asked", async () => {
    const { model, t } = await fixtureModel({ route: "monitor" });
    expect(t.calls("history.list")).toHaveLength(0);
    expect(model.handle.value).toBeUndefined();
    expect(model.monitorRows.value[0]!.summary.thread_id).toBe("broken");
    model.monitorFilter.value = "completed";
    expect(model.monitorRows.value.map((r) => r.summary.thread_id)).toEqual(["done"]);
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
    t.ok(call.id, { message_id: "m" });
    expect(await sent).toBe(true);
    expect(model.sendState.value.kind).toBe("idle");
    expect(model.conversation.value.length).toBe(rowsBefore);
  });

  it("a lost reply is unconfirmed; resending reuses the operation id", async () => {
    const { model, t } = await fixtureModel();
    const sent = model.send("hello");
    await flush();
    const first = t.calls("message.send")[0]!;
    t.drop();
    expect(await sent).toBe(false);
    expect(model.sendState.value).toMatchObject({ kind: "unconfirmed", text: "hello" });
    t.open();
    const again = model.resend();
    await flush();
    const second = t.calls("message.send")[1]!;
    expect(second.operation_id).toBe(first.operation_id);
    t.ok(second.id, {});
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

  it("the live preview signal stays connected to the data layer's stream frame", async () => {
    const { model, t } = await fixtureModel();
    t.push({ t: "stream", thread_id: "lead", cursor: "c", text: "partial", gap: false });
    expect(model.handle.value!.preview.value).toEqual({ kind: "live", text: "partial", cursor: "c" });
  });

  it("leaving the Conversation stops reading its Thread, and returning reads only what's new", async () => {
    const { model, t, db } = await fixtureModel();
    const reads = () => t.calls("history.list").length;
    model.applyRoute({ view: "monitor" });
    await flush();
    expect(t.watches().at(-1)!.thread_ids).toEqual([]);
    const away = reads();
    t.push({ t: "changed", thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(reads()).toBe(away);
    expect(model.conversation.value.length).toBeGreaterThan(0);
    model.applyRoute({ view: "conversation", threadId: "lead" });
    await settle(t, db);
    expect(t.watches().at(-1)!.thread_ids).toEqual(["lead"]);
    expect(reads()).toBe(away + 1);
    expect((t.calls("history.list").at(-1)!.args as { since?: string }).since).toBeDefined();
  });

  it("switching Thread cancels the old one's reads and closing a step cancels its output read", async () => {
    const { model, t, db } = await fixtureModel();
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
    const sent = t.calls("history.list").at(-1)!;
    model.openThread("lead");
    await flush();
    expect(t.cancels()).toContain(sent.id);
    db.answered.add(sent.id);
    await settle(t, db);
    expect(model.selectedId.value).toBe("lead");
    expect(model.conversation.value.length).toBeGreaterThan(0);
  });
});
