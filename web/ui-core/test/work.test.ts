import { describe, expect, it } from "vitest";
import { toolLabel, workRegions } from "../src";
import { fixtureModel } from "./fixture";
import { flush, settle } from "../../data/test/harness";

describe("bounded conversation work", () => {
  it("uses only the selected run's active shells and current messages", () => {
    const page = { items: [
      { kind: "shell", id: "s", thread_id: "t", run_id: "r", execution_id: "s", state: "running", started_at: "2026-01-01T00:00:00Z" },
      { kind: "shell", id: "foreign", thread_id: "t", run_id: "old", execution_id: "foreign", state: "running" },
      { kind: "message", id: "m", thread_id: "t", message_id: "m", state: "held" },
      { kind: "message", id: "done", thread_id: "t", message_id: "done", state: "applied" },
    ], next_cursor: "more" };
    const regions = workRegions(page, "r", new Map([["s", { execution_id: "s", state: "running", command_excerpt: "test" }]]));
    expect(regions.running.map((r) => r.label)).toEqual(["test"]);
    expect(regions.pending.map((r) => r.id)).toEqual(["m"]);
    expect(regions.partial).toBe(true);
  });

  it("uses descriptions before commands and falls back to the shell start time", () => {
    expect(toolLabel("  inspect files  ", "ls")).toBe("inspect files");
    expect(toolLabel("  ", "ls")).toBe("ls");
    const page = { items: [{ kind: "shell", id: "x", thread_id: "t", run_id: "r", execution_id: "x", state: "running" }] };
    const shells = new Map([["x", { execution_id: "x", state: "running", description: "Inspect files", command_excerpt: "ls", started_at: "2026-01-01T00:00:00Z" }]]);
    expect(workRegions(page, "r", shells).running[0]).toMatchObject({ label: "Inspect files", startedAt: "2026-01-01T00:00:00Z" });
  });

  it("reads a bounded page only while viewing and follows hints", async () => {
    const { model, t, db } = await fixtureModel();
    db.bodies.m = "Hello pending message";
    db.work.lead = [{ kind: "message", id: "m", message_id: "m", thread_id: "lead", state: "held" }];
    t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(model.work.value.pending.map((r) => r.label)).toEqual(["Hello pending message"]);
    const calls = t.calls("status");
    expect(calls.at(-1)?.args).toMatchObject({ thread_id: "lead", limit: 200 });
    db.work.lead = [];
    t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(model.work.value.pending).toEqual([]);
    model.dispose();
  });
  it("hides stale pending messages when the saved conversation arrives before status", async () => {
    const { model, t, db } = await fixtureModel();
    db.bodies.m = "Delivered message";
    db.work.lead = [{ kind: "message", id: "m", message_id: "m", thread_id: "lead", state: "held" }];
    t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }); await settle(t, db);
    expect(model.work.value.pending.map((r) => r.id)).toEqual(["m"]);
    db.work.lead = [];
    db.history.lead!.push({ node_id: "m", kind: "user", excerpt: "Delivered message", execution_count: 0 });
    t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }); await flush();
    const status = t.calls("status").at(-1)!;
    for (const call of t.calls().filter((c) => !db.answered.has(c.id) && c.id !== status.id)) {
      db.answered.add(call.id); const response = db.answer(call);
      if (response.ok) t.ok(call.id, response.result); else t.ownerError(call.id, response.code);
    }
    await flush();
    expect(model.conversation.value.some((row) => row.type === "message" && row.text === "Delivered message")).toBe(true);
    expect(model.work.value.pending).toEqual([]);
    await settle(t, db); expect(model.work.value.pending).toEqual([]); model.dispose();
  });
  it("reads no more than eight pending bodies", async () => {
    const { model, t, db } = await fixtureModel();
    db.work.lead = Array.from({ length: 12 }, (_, n) => ({ kind: "message", id: `m${n}`, message_id: `m${n}`, thread_id: "lead", state: "held" }));
    t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(t.calls("history.get")).toHaveLength(8);
    expect(t.calls("history.get").every((call) => (call.args as {limit_bytes: number}).limit_bytes === 1024)).toBe(true);
    model.dispose();
  });
  it("uses the cancellation receipt's per-message outcome", async () => {
    const { model, t } = await fixtureModel({configure(db) {
      db.work.lead = [{ kind: "message", id: "m", message_id: "m", thread_id: "lead", state: "held" }];
    }});
    const result = model.runPanelOperation("m", { kind: "cancel", target: "pending" });
    await flush();
    const call = t.calls("message.cancel").at(-1)!;
    expect(call.args).toEqual({ message_ids: ["m"] });
    t.ok(call.id, { items: [{ message_id: "m", outcome: "already_admitted" }] });
    await result;
    expect(model.panelOperations.peek().get("m")).toMatchObject({ disposition: "failed", error: "already_admitted" });
    model.dispose();
  });
});
