import { expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { Cancel } from "../src/operations";
import { connectedWithHistory, FakeTransport, flush } from "./harness";
it("new ordinary saved nodes publish without waiting for publication lookup or status", async () => {
  const t = new FakeTransport(); let id = 0;
  const data = new ShellboyData({ transport: t, newId: () => `saved-${++id}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connectedWithHistory }); await flush();
  const view = data.openThread("saved");
  const first = view.readWindow({}, new Cancel()); await flush();
  t.ok(t.calls("history.window").at(-1)!.id, { thread_id: "saved", revision: 1, total: 1, items: [{ node_id: "a", kind: "user", selection: { ordinal: 0 } }] }); await first;
  let done = false;
  const second = view.readWindow({}, new Cancel()).then(out => { done = true; return out; }); await flush();
  t.ok(t.calls("history.window").at(-1)!.id, { thread_id: "saved", revision: 2, total: 2, items: [{ node_id: "b", kind: "assistant_response", excerpt: "saved safe excerpt", selection: { ordinal: 1 } }] }); await flush();
  expect(done).toBe(true);
  const out = await second; expect(out.ok).toBe(true);
  if (out.ok) { expect(out.value.items[0]!.assistant_publication).toBeUndefined(); expect(Object.isFrozen(out.value.items[0])).toBe(true); }
  expect(t.calls("thread.handoff")).toHaveLength(0); data.stop();
});

it("preserves empty, partial text, zero-ID tool and whole deferred ordinary nodes in one immutable revision", async () => {
  const t = new FakeTransport(); let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `ordinary-${++n}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connectedWithHistory }); await flush();
  const view = data.openThread("saved"); const pending = view.readWindow({ items: true }, new Cancel()); await flush();
  const rows = [
    { node_id: "empty", kind: "user", items: [], selection: { ordinal: 0 } },
    { node_id: "partial", kind: "assistant_response", items: [{ kind: "text", item_identity: "text", text: "", text_complete: false }], selection: { ordinal: 1 } },
    { node_id: "tool", kind: "assistant_response", items: [{ kind: "tool_call", item_identity: "tool", execution_ids: [] }], selection: { ordinal: 2 } },
    { node_id: "reasoning", kind: "assistant_response", items: [{ kind: "reasoning_unavailable", item_identity: "reason" }], selection: { ordinal: 3 } },
    { node_id: "deferred", kind: "tool_result", items: null, items_unavailable_reason: "response_budget", selection: { ordinal: 4 } },
  ];
  t.ok(t.calls("history.window").at(-1)!.id, { thread_id: "saved", revision: 12, total: 5, items: rows });
  const out = await pending; expect(out.ok).toBe(true);
  if (out.ok) {
    expect(out.value).toMatchObject({ total: 5, revision: 12, items: rows });
    expect(out.value.items.map(row => row.node_id)).toEqual(rows.map(row => row.node_id));
    expect(Object.isFrozen(out.value.items)).toBe(true); expect(Object.isFrozen(out.value.items[2]!.items![0])).toBe(true);
    expect(out.value.items.every(row => row.assistant_publication === undefined)).toBe(true);
  }
  expect(t.calls("status")).toHaveLength(0); data.stop();
});

it.each(["cancel", "pause", "close", "ABA"] as const)("rejects delayed saved results after %s without adding qualification work", async action => {
  const t = new FakeTransport(); let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `stale-${++n}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connectedWithHistory }); await flush();
  const view = data.openThread("saved"); const pending = view.readWindow({ items: true }, new Cancel()); await flush();
  const held = t.calls("history.window").at(-1)!;
  if (action === "cancel") view.cancelReads(); else if (action === "pause") view.pause(); else if (action === "close") view.close(); else {
    t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } });
    t.push({ t: "owner", event: "connected", owner: connectedWithHistory });
  }
  t.ok(held.id, { thread_id: "saved", revision: 1, total: 1, items: [{ node_id: "obsolete", kind: "user", items: [], selection: { ordinal: 0 } }] });
  expect((await pending).ok).toBe(false); expect(t.calls("status")).toHaveLength(0); data.stop();
});
