import { describe, expect, it } from "vitest";
import { Link, MAX_IN_FLIGHT, MAX_OUTSTANDING } from "../src/link";
import { FakeTransport, flush } from "./harness";

function setup() {
  const t = new FakeTransport();
  const link = new Link(t);
  link.start();
  t.open();
  return { t, link };
}

describe("Link", () => {
  it("fails fast with not_connected when the socket is closed", async () => {
    const t = new FakeTransport();
    const link = new Link(t);
    link.start();
    const r = await link.call("thread.list", {}).promise;
    expect(r).toEqual({ ok: false, error: { kind: "not_connected", message: expect.any(String) } });
    expect(t.sent).toEqual([]);
  });

  it("never has more than MAX_IN_FLIGHT calls on the wire and keeps order", async () => {
    const { t, link } = setup();
    const replies = Array.from({ length: 7 }, (_, i) => link.call("thread.get", { n: i }));
    expect(t.calls()).toHaveLength(MAX_IN_FLIGHT);
    t.ok(t.calls()[0]!.id, { a: 1 });
    await flush();
    expect(t.calls()).toHaveLength(MAX_IN_FLIGHT + 1);
    expect((t.calls()[4]!.args as { n: number }).n).toBe(4);
    for (const c of t.calls().slice(1)) t.ok(c.id, {});
    await flush();
    for (const c of t.calls().slice(5)) t.ok(c.id, {});
    const results = await Promise.all(replies.map((r) => r.promise));
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("puts mutations ahead of queued reads but behind earlier mutations", () => {
    const { t, link } = setup();
    for (let i = 0; i < MAX_IN_FLIGHT; i++) link.call("thread.get", { fill: i });
    link.call("thread.list", { read: 1 });
    link.call("message.send", { m: 1 }, { operationId: "op-1" });
    link.call("message.send", { m: 2 }, { operationId: "op-2" });
    link.call("thread.list", { read: 2 });
    // free slots one at a time and observe the send order
    const order: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      t.ok(t.calls()[i]!.id, {});
    }
    order.push(...t.calls().slice(MAX_IN_FLIGHT).map((c) => c.args));
    expect(order).toEqual([{ m: 1 }, { m: 2 }, { read: 1 }, { read: 2 }]);
    expect(t.calls()[MAX_IN_FLIGHT]!.operation_id).toBe("op-1");
  });

  it("answers busy locally past MAX_OUTSTANDING instead of growing a queue", async () => {
    const { link } = setup();
    for (let i = 0; i < MAX_OUTSTANDING; i++) link.call("thread.get", {});
    const r = await link.call("thread.get", {}).promise;
    expect(r).toEqual({ ok: false, error: { kind: "busy", message: expect.any(String) } });
  });

  it("on close: sent mutation is unconfirmed, sent read is lost, unsent calls were never sent", async () => {
    const { t, link } = setup();
    const m = link.call("message.send", { text: "x" }, { operationId: "op-9" });
    const reads = Array.from({ length: MAX_IN_FLIGHT }, () => link.call("thread.get", {}));
    const queued = link.call("thread.list", {});
    t.drop();
    expect(await m.promise).toEqual({
      ok: false,
      error: { kind: "unconfirmed", message: expect.any(String), operationId: "op-9" },
    });
    expect((await reads[0]!.promise).ok).toBe(false);
    expect(await reads[0]!.promise).toMatchObject({ error: { kind: "connection_lost" } });
    expect(await queued.promise).toMatchObject({ error: { kind: "not_connected" } });
  });

  it("cancel: queued call is dropped silently, sent call gets a cancel frame and its reply is discarded", async () => {
    const { t, link } = setup();
    const sent = link.call("thread.get", { a: 1 });
    for (let i = 1; i < MAX_IN_FLIGHT; i++) link.call("thread.get", {});
    const queued = link.call("thread.get", { q: 1 });
    queued.cancel();
    expect(await queued.promise).toMatchObject({ error: { kind: "cancelled" } });
    const id = t.calls()[0]!.id;
    sent.cancel();
    expect(t.cancels()).toEqual([id]);
    t.ok(id, {}); // late reply: ignored
    expect(await sent.promise).toMatchObject({ error: { kind: "cancelled" } });
    expect(t.calls().some((c) => (c.args as { q?: number }).q === 1)).toBe(false);
  });

  it("maps a bridge busy error and an owner_call_failed error", async () => {
    const { t, link } = setup();
    const a = link.call("thread.get", {});
    const b = link.call("thread.get", {});
    t.push({ t: "result", id: t.calls()[0]!.id, error: { code: "busy", message: "m" } });
    t.push({
      t: "result",
      id: t.calls()[1]!.id,
      error: { code: "owner_call_failed", message: "m", owner_error: { code: "not_found", message: "gone" } },
    });
    expect(await a.promise).toMatchObject({ error: { kind: "busy" } });
    expect(await b.promise).toMatchObject({ error: { kind: "owner", code: "not_found" } });
  });

  it("counts failed attempts until an open", () => {
    const t = new FakeTransport();
    const link = new Link(t);
    link.start();
    t.drop();
    t.drop();
    expect(link.failedAttempts.value).toBe(2);
    t.open();
    expect(link.failedAttempts.value).toBe(0);
  });
});
