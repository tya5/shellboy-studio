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
      response: { protocol_version: 5, operation_id: "o", ok: false, error: { code: "not_found", message: "no", hint: "list" } },
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
    t.push({ t: "result", id: t.calls()[2]!.id, response: { protocol_version: 5, operation_id: "o", ok: true } });
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
    for (const c of cmds) t.ok(c.id, c.command === "message.send" ? {message_id:"accepted-message",thread_id:"a"} : { done: true });
    await flush();
    expect(await send).toEqual({ ok: true, value: {message_id:"accepted-message",thread_id:"a"}, operationId: "uuid-1" });
    expect(await retry).toMatchObject({ operationId: "mine" });
    expect(await stop).toMatchObject({ ok: true });
    expect(await arch).toMatchObject({ ok: true });
  });

  it("tag calls: tag edits are mutations, the name lists and filters are plain reads", async () => {
    const { t, ops } = setup();
    const tag = ops.threadTag({ thread_ids: ["a"], add: ["x"] });
    const tags = ops.threadTags({ limit: 200 });
    const cwds = ops.threadCwds({ limit: 200, cursor: "c" });
    const list = ops.threadList({ limit: 100, tags: ["x", "y"], cwd: "/w" });
    const cmds = t.calls();
    expect(cmds.map((c) => [c.command, c.operation_id])).toEqual([["thread.tag", "uuid-1"], ["thread.tags", undefined], ["thread.cwds", undefined], ["thread.list", undefined]]);
    expect(cmds[0]!.args).toEqual({ thread_ids: ["a"], add: ["x"] });
    expect(cmds[3]!.args).toEqual({ limit: 100, tags: ["x", "y"], cwd: "/w" });
    t.ok(cmds[0]!.id, { changed: ["a"], unchanged: [], not_found: [], add: ["x"], remove: [] });
    t.ok(cmds[1]!.id, { items: ["x", "y"], next_cursor: "n" });
    t.ok(cmds[2]!.id, { items: 5 });
    t.ok(cmds[3]!.id, { items: [{ thread_id: "a", title: "A", state: "idle", tags: ["x", 3] }] });
    await flush();
    expect(await tag).toMatchObject({ ok: true, value: { changed: ["a"] } });
    expect(await tags).toEqual({ ok: true, value: { items: ["x", "y"], next_cursor: "n" } });
    expect(await cwds).toMatchObject({ ok: false });
    expect(await list).toMatchObject({ ok: false });
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
    t.ok(t.calls().at(-1)!.id, { message_id:"accepted-message",thread_id:"a",receipt: "same" });
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

describe("Operations added for the presentation", () => {
  it("history.get, shell.list and shell.read decode what the owner returns", async () => {
    const { t, ops } = setup();
    const body = ops.historyGet({ node_id: "n" });
    t.ok(t.calls("history.get")[0]!.id, { node_id: "n", kind: "user", text: "full" });
    expect(await body).toMatchObject({ ok: true, value: { text: "full" } });
    const list = ops.shellList({ thread_id: "a", limit: 5 });
    t.ok(t.calls("shell.list")[0]!.id, { items: [{ execution_id: "e", state: "exited", exit_code: 0 }], next_cursor: null });
    expect(await list).toMatchObject({ ok: true, value: { items: [{ execution_id: "e" }] } });
    const read = ops.shellRead({ execution_id: "e" });
    t.ok(t.calls("shell.read")[0]!.id, { execution_id: "e", text: "out", output_complete: true });
    expect(await read).toMatchObject({ ok: true, value: { text: "out" } });
  });

  it("thread.create is a mutation with an operation id", async () => {
    const { t, ops } = setup();
    const made = ops.threadCreate({ cwd: "/w" });
    const call = t.calls("thread.create")[0]!;
    expect(call.operation_id).toBe("uuid-1");
    t.ok(call.id, details("a"));
    expect(await made).toMatchObject({ ok: true, value: { thread_id: "a" }, operationId: "uuid-1" });
  });

  it("an undecodable shell entry is a loud invalid_response", async () => {
    const { t, ops } = setup();
    const list = ops.shellList({ thread_id: "a" });
    t.ok(t.calls("shell.list")[0]!.id, { items: [{ nope: 1 }] });
    expect(await list).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
});

describe("Reads for Analytics and Settings", () => {
  it("send the owner's argument names and never an operation id", async () => {
    const { t, ops } = setup();
    void ops.usageGet({ group_by: "day", timezone: "+09:00", since: "s", until: "u", limit: 168 });
    void ops.compactList({ thread_id: "a", limit: 50 });
    void ops.storageStatus();
    void ops.indexStatus();
    void ops.memoryStatus();
    void ops.modelList();
    // Four on the wire at once; the rest go out as replies arrive.
    for (const c of t.calls().slice(0, 4)) t.ok(c.id, {});
    await flush();
    expect(t.calls().map((c) => [c.command, c.args])).toEqual([
      ["usage.get", { group_by: "day", timezone: "+09:00", since: "s", until: "u", limit: 168 }],
      ["compact.list", { thread_id: "a", limit: 50 }],
      ["storage.status", {}],
      ["index.status", {}],
      ["status", { memory: true }],
      ["model.list", {}],
    ]);
    expect(t.calls().every((c) => c.operation_id === undefined)).toBe(true);
  });
  it("model.list needs a connection and a model array", async () => {
    const { t, ops } = setup();
    const p = ops.modelList();
    t.ok(t.calls()[0]!.id, { models: "nope" });
    expect(await p).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });
});

describe("Reads and mutations for Branches and Threads", () => {
  it("a rewind preview is a dry run with no operation id; the real rewind carries one", async () => {
    const { t, ops } = setup();
    void ops.threadRewindPreview({ thread_id: "a", node_id: "n" });
    void ops.threadRewind({ thread_id: "a", node_id: "n" });
    void ops.threadFork({ thread_id: "a", node_id: "n" });
    void ops.threadUnarchive(["a"], { descendants: true });
    const [preview, rewind, fork, unarchive] = t.calls();
    expect(preview).toMatchObject({ command: "thread.rewind", args: { thread_id: "a", node_id: "n", dry_run: true } });
    expect(preview!.operation_id).toBeUndefined();
    expect(rewind!.args).toEqual({ thread_id: "a", node_id: "n" });
    expect(rewind!.operation_id).toBeTruthy();
    expect(fork).toMatchObject({ command: "thread.fork", args: { thread_id: "a", node_id: "n" } });
    expect(fork!.operation_id).toBeTruthy();
    expect(unarchive).toMatchObject({ command: "thread.unarchive", args: { thread_ids: ["a"], descendants: true } });
  });
  it("branches sends the owner's argument names", async () => {
    const { t, ops } = setup();
    void ops.threadBranches({ thread_id: "a", limit: 200, cursor: "c" });
    expect(t.calls()[0]).toMatchObject({ command: "thread.branches", args: { thread_id: "a", limit: 200, cursor: "c" } });
    expect(t.calls()[0]!.operation_id).toBeUndefined();
  });
});
