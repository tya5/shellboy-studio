import { describe, expect, it } from "vitest";
import { Link } from "../src/link";
import { Operations } from "../src/operations";
import { details, FakeTransport, flush, summary } from "./harness";

function setup() {
  const t = new FakeTransport();
  const link = new Link(t);
  link.start();
  t.open();
  let n = 0;
  return { t, ops: new Operations(link, () => `uuid-${++n}`) };
}

describe("Operations", () => {
  it("thread list: sends the owner's argument names and decodes a page", async () => {
    const { t, ops } = setup();
    const p = ops.threadList({ limit: 5, archived: "only", query: "q" });
    expect(t.calls()[0]).toMatchObject({ command: "thread.list", args: { limit: 5, archived: "only", query: "q" } });
    expect(t.calls()[0]!.operation_id).toBeUndefined();
    t.ok(t.calls()[0]!.id, { items: [summary("a")], next_cursor: "c1" });
    expect(await p).toEqual({ ok: true, value: { items: [summary("a")], next_cursor: "c1" } });
  });

  it("thread get and history read", async () => {
    const { t, ops } = setup();
    const g = ops.threadGet("a");
    const h = ops.historyList({ thread_id: "a", limit: 2, cursor: "x" });
    expect(t.calls().map((c) => [c.command, c.args])).toEqual([
      ["thread.get", { thread_id: "a" }],
      ["history.list", { thread_id: "a", limit: 2, cursor: "x" }],
    ]);
    t.ok(t.calls()[0]!.id, details("a"));
    t.ok(t.calls()[1]!.id, { items: [{ node_id: "n1" }] });
    expect(await g).toMatchObject({ ok: true, value: { thread_id: "a" } });
    expect(await h).toEqual({ ok: true, value: { items: [{ node_id: "n1" }] } });
  });

  it("owner errors carry code, message and hint", async () => {
    const { t, ops } = setup();
    const p = ops.threadGet("zzz");
    t.push({
      t: "result",
      id: t.calls()[0]!.id,
      response: { protocol_version: 2, operation_id: "o", ok: false, error: { code: "not_found", message: "no", hint: "list" } },
    });
    expect(await p).toEqual({ ok: false, error: { kind: "owner", code: "not_found", message: "no", hint: "list" } });
  });

  it("rejects undecodable results loudly instead of passing them on", async () => {
    const { t, ops } = setup();
    const a = ops.threadList();
    const b = ops.threadGet("a");
    const c = ops.runStop("r");
    t.ok(t.calls()[0]!.id, { items: [{ title: "no id" }] });
    t.ok(t.calls()[1]!.id, "string");
    t.push({ t: "result", id: t.calls()[2]!.id, response: { protocol_version: 2, operation_id: "o", ok: true } });
    for (const r of await Promise.all([a, b, c])) expect(r).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it("mutations carry an operation id, reuse a given one, and report it back", async () => {
    const { t, ops } = setup();
    const send = ops.messageSend({ thread_id: "a", text: "hi", deliver: "now" });
    const stop = ops.runStop("run-1");
    const retry = ops.runRetry("run-1", "mine");
    const arch = ops.threadArchive(["a", "b"], { descendants: true });
    const cmds = t.calls();
    expect(cmds.map((c) => [c.command, c.operation_id])).toEqual([
      ["message.send", "uuid-1"],
      ["run.stop", "uuid-2"],
      ["run.retry", "mine"],
      ["thread.archive", "uuid-3"],
    ]);
    expect(cmds[0]!.args).toEqual({ thread_id: "a", text: "hi", deliver: "now" }); // bridge sets human/sender_label
    expect(cmds[3]!.args).toEqual({ thread_ids: ["a", "b"], descendants: true });
    for (const c of cmds) t.ok(c.id, { done: true });
    await flush();
    expect(await send).toEqual({ ok: true, value: { done: true }, operationId: "uuid-1" });
    expect(await retry).toMatchObject({ operationId: "mine" });
    expect(await stop).toMatchObject({ ok: true });
    expect(await arch).toMatchObject({ ok: true });
  });

  it("a lost mutation reply is unconfirmed and retrying reuses the operation id", async () => {
    const { t, ops } = setup();
    const first = ops.messageSend({ thread_id: "a", text: "hi" });
    t.drop();
    const r = await first;
    expect(r).toMatchObject({ ok: false, error: { kind: "unconfirmed", operationId: "uuid-1" }, operationId: "uuid-1" });
    t.open();
    const again = ops.messageSend({ thread_id: "a", text: "hi" }, "uuid-1");
    expect(t.calls().at(-1)!.operation_id).toBe("uuid-1");
    t.ok(t.calls().at(-1)!.id, { receipt: "same" });
    expect(await again).toMatchObject({ ok: true });
  });

  it("operation.get looks a receipt up", async () => {
    const { t, ops } = setup();
    const p = ops.operationGet("uuid-1");
    expect(t.calls()[0]).toMatchObject({ command: "operation.get", args: { operation_id: "uuid-1" } });
    t.ok(t.calls()[0]!.id, { state: "done" });
    expect(await p).toMatchObject({ ok: true });
  });
});
