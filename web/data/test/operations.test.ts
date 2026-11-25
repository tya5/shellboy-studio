import { describe, expect, it } from "vitest";
import { Link } from "../src/link";
import { memoryReadIssue, Operations, type ArchiveResult } from "../src/operations";
import { details, FakeTransport, flush, summary } from "./harness";

function setup() {
  const t = new FakeTransport();
  const link = new Link(t);
  link.start();
  t.open();
  let n = 0;
  return { t, ops: new Operations(link, () => `uuid-${++n}`, () => true) };
}

describe("Operations", () => {
  it("bounds artifact pages and rejects mismatched Thread and version identities", async () => {
    const { t, ops } = setup();
    const at = "2026-11-21T00:00:00Z";
    const identity = { artifact_id: "report", thread_id: "a", created_at: at, updated_at: at };
    const latest = { version: 2, title: "Report", uri: "/fixture/report.md", mime: "text/markdown", created_at: at };
    const row = { ...identity, latest };
    const list = ops.artifactList("a", "opaque");
    expect(t.calls()[0]).toMatchObject({ command: "artifact.list", args: { thread_id: "a", cursor: "opaque", limit: 32 } });
    expect(t.calls()[0]!.operation_id).toBeUndefined();
    t.ok(t.calls()[0]!.id, { items: [row], next_cursor: null });
    await expect(list).resolves.toEqual({ ok: true, ownerOperationId: "op", value: { items: [row], limit: 32, filters: { thread_id: "a" } } });
    const duplicate = ops.artifactList("a");
    t.ok(t.calls()[1]!.id, { items: [row, row] });
    await expect(duplicate).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    const history = ops.artifactHistory("a", "report");
    t.ok(t.calls()[2]!.id, { ...row, thread_id: "b", versions: { items: [] } });
    await expect(history).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    const selected = ops.artifactVersion("a", "report", 1);
    expect(t.calls()[3]).toMatchObject({ command: "artifact.get", args: { artifact_id: "report", version: 1 } });
    t.ok(t.calls()[3]!.id, { ...identity, version: latest });
    await expect(selected).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it("preserves encoded archive/unarchive boolean descendants without narrowing unknown replies", async () => {
    // Core #292 real-producer fixture: changed/already/not_found arrays and a boolean mode.
    for (const verb of ["archive", "unarchive"] as const) {
      for (const descendants of [false, true]) {
        const encoded = JSON.stringify({
          [verb === "archive" ? "archived" : "unarchived"]: ["synthetic-root"],
          already: [], not_found: ["synthetic-missing"], descendants,
        });
        const { t, ops } = setup();
        const pending = verb === "archive"
          ? ops.threadArchive(["synthetic-root"], { descendants })
          : ops.threadUnarchive(["synthetic-root"], { descendants });
        t.ok(t.calls()[0]!.id, JSON.parse(encoded));
        const out = await pending;
        expect(out.ok).toBe(true);
        if (out.ok) {
          const mode: boolean | undefined = out.value.descendants;
          expect(mode).toBe(descendants);
        }
      }
    }
    const known: ArchiveResult = { descendants: true };
    expect(known.descendants).toBe(true);
    // Missing is optional; malformed wire fields stay unknown at the generic decoder boundary.
    for (const raw of [{}, { descendants: null }, { descendants: "unknown" }]) {
      const { t, ops } = setup();
      const pending = ops.threadArchive(["synthetic-root"]);
      t.ok(t.calls()[0]!.id, raw);
      const out = await pending;
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.value).toEqual(raw);
    }
  });

  it("thread list: sends the owner's argument names and decodes a page", async () => {
    const { t, ops } = setup();
    const p = ops.threadList({ limit: 5, archived: "only", query: "q" });
    expect(t.calls()[0]).toMatchObject({ command: "thread.list", args: { limit: 5, archived: "only", query: "q" } });
    expect(t.calls()[0]!.operation_id).toBeUndefined();
    t.ok(t.calls()[0]!.id, { items: [summary("a")], next_cursor: "c1" });
    expect(await p).toEqual({ ok: true, ownerOperationId: "op", value: { items: [summary("a")], limit: 5, filters: {}, next_cursor: "c1" } });
  });

  it("public history capture contains toJSON and getter failures as Outcomes", async () => {
    const { t, ops } = setup();
    const toJson = { thread_id: "a", revision: 1, total: 0, items: [] as unknown[] };
    Object.defineProperty(toJson, "toJSON", { value: () => { throw new Error("secret getter text"); } });
    const first = ops.historyWindow({ thread_id: "a" });
    t.ok(t.calls()[0]!.id, toJson);
    await expect(first).resolves.toMatchObject({ ok: true });

    const second = ops.historyWindow({ thread_id: "a" });
    const raw = { thread_id: "a", revision: 1, total: 0, items: [] as unknown[] } as { thread_id: string; revision: number; total: number; items: unknown[]; revision_text?: string };
    Object.defineProperty(raw, "revision_text", { get: () => { throw new Error("private getter text"); }, enumerable: true });
    t.ok(t.calls()[1]!.id, raw);
    await expect(second).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it("public history capture reads text and ordinal once and isolates caller mutation", async () => {
    const { t, ops } = setup(); let textReads = 0; let ordinalReads = 0; let externalText = "short";
    const item = { node_id: "n", kind: "assistant_response", selection: {} as { ordinal?: number }, provenance: { message: { expect_reply: false, reply_to: "prior" } }, items: [{ kind: "text", item_identity: "body", text_complete: true, text: "short" }] };
    Object.defineProperty(item.selection, "ordinal", { enumerable: true, get: () => { ordinalReads++; return 0; } });
    Object.defineProperty(item.items[0], "text", { enumerable: true, get: () => { textReads++; return textReads <= 2 ? externalText : "x".repeat(20000); }, set: (value: string) => { externalText = value; } });
    const pending = ops.historyWindow({ thread_id: "a" }); t.ok(t.calls()[0]!.id, { thread_id: "a", revision: 1, total: 1, items: [item] });
    const out = await pending; expect(out.ok).toBe(true); expect(textReads).toBe(1); expect(ordinalReads).toBe(1);
    if (out.ok) { const result = out.value.items[0]!; expect(result.items?.[0]).toMatchObject({ text: "short" }); item.items[0]!.text = "caller mutation"; expect(result.items?.[0]).toMatchObject({ text: "short" }); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.provenance?.message)).toBe(true); expect(() => { result.node_id = "changed"; }).toThrow(); expect(() => { if(result.provenance?.message && "reply_to" in result.provenance.message) result.provenance.message.reply_to = "changed"; }).toThrow(); }
  });

  it("public history capture rejects the first oversized value with a body-free bound error", async () => {
    const { t, ops } = setup(); let reads = 0;
    const item = { node_id: "n", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "text", item_identity: "body", text_complete: true, text: "short" }] };
    Object.defineProperty(item.items[0], "text", { enumerable: true, get: () => { reads++; return "x".repeat(20000); } });
    const pending = ops.historyWindow({ thread_id: "a" }); t.ok(t.calls()[0]!.id, { thread_id: "a", revision: 1, total: 1, items: [item] });
    await expect(pending).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response", message: "invalid-input" } }); expect(reads).toBe(1);
  });

  it.each(["handoffAttempts", "threadWork"] as const)("public Work capture never invokes metadata toJSON: %s", async route => {
    const { t, ops } = setup(); let calls = 0; const metadata = { value: "kept" };
    Object.defineProperty(metadata, "toJSON", { enumerable: false, get: () => { calls++; throw new Error("must not run"); } });
    const pending = route === "handoffAttempts" ? ops.handoffAttempts("selected") : ops.threadWork("selected");
    t.ok(t.calls("status")[0]!.id, { items: [{ kind: "run", id: "r", thread_id: "selected", state: "live", metadata }] });
    const out = await pending; expect(out.ok).toBe(true); expect(calls).toBe(0);
  });

  it("history.window fails closed when capability was not advertised", async () => {
    const t = new FakeTransport();
    const link = new Link(t);
    link.start(); t.open();
    const ops = new Operations(link, () => "unsupported-owner");
    const result = await ops.historyWindow({ thread_id: "a", before: 0, after: 0 });
    expect(result).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    expect(t.calls("history.window")).toHaveLength(0);
    link.stop();
  });

  it("thread get and current positional history read", async () => {
    const { t, ops } = setup();
    const g = ops.threadGet("a");
    const h = ops.historyWindow({ thread_id: "a", before: 0, after: 0 });
    expect(t.calls().map((c) => [c.command, c.args])).toEqual([
      ["thread.get", { thread_id: "a" }],
      ["history.window", { thread_id: "a", before: 0, after: 0 }],
    ]);
    t.ok(t.calls()[0]!.id, details("a"));
    t.ok(t.calls()[1]!.id, { thread_id: "a", revision: 1, total: 1, items: [{ node_id: "n1", selection: { ordinal: 0 } }] });
    expect(await g).toMatchObject({ ok: true, value: { thread_id: "a" } });
    expect(await h).toMatchObject({ ok: true, value: { thread_id: "a", revision: 1, total: 1, items: [{ node_id: "n1" }] } });
    expect(t.calls("history.window")).toHaveLength(1);
    expect(t.calls("history.list")).toHaveLength(0);
  });

  it("history.window accepts only the typed available or response-budget deferred states", async () => {
    const cases = [
      { node_id: "n1", selection: { ordinal: 0 }, items: [{ kind: "text", item_identity: "n1/body", text: "body", text_complete: true }] },
      { node_id: "n1", selection: { ordinal: 0 }, items: null, items_unavailable_reason: "response_budget" },
    ];
    for (const node of cases) {
      const { t, ops } = setup();
      const pending = ops.historyWindow({ thread_id: "a", before: 0, after: 0 });
      t.ok(t.calls()[0]!.id, { thread_id: "a", revision: 1, total: 1, items: [node] });
      expect((await pending).ok).toBe(true);
    }
    for (const reason of ["pruned", "source_budget", "opaque"] as const) {
      const { t, ops } = setup();
      const pending = ops.historyWindow({ thread_id: "a", before: 0, after: 0 });
      t.ok(t.calls()[0]!.id, { thread_id: "a", revision: 1, total: 1, items: [{ node_id: "n1", selection: { ordinal: 0 }, items: null, items_unavailable_reason: reason }] });
      expect((await pending).ok).toBe(false);
    }
  });

  it("owner errors carry code, message and hint", async () => {
    const { t, ops } = setup();
    const p = ops.threadGet("zzz");
    t.push({
      t: "result",
      id: t.calls()[0]!.id,
      response: { protocol_version: 5, operation_id: "o", ok: false, error: { code: "not_found", message: "no", hint: "list" } },
    });
    expect(await p).toEqual({ ok: false, ownerOperationId: "o", error: { kind: "owner", code: "not_found", message: "no", hint: "list" } });
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
    expect(await send).toEqual({ ok: true, ownerOperationId: "op", value: {message_id:"accepted-message",thread_id:"a"}, operationId: "uuid-1" });
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
    expect(await tags).toEqual({ ok: true, ownerOperationId: "op", value: { items: ["x", "y"], limit: 200, filters: {}, next_cursor: "n" } });
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
  it("history.read, shell.list and shell.read decode what the owner returns", async () => {
    const { t, ops } = setup();
    const body = ops.historyGet({ node_id: "n" });
    t.ok(t.calls("history.read")[0]!.id, { node_id: "n", kind: "user", text: "full" });
    expect(await body).toMatchObject({ ok: true, value: { text: "full" } });
    const list = ops.shellList({ thread_id: "a", limit: 5 });
    t.ok(t.calls("shell.list")[0]!.id, { items: [{ execution_id: "e", state: "exited", exit_code: 0 }], next_cursor: null });
    expect(await list).toMatchObject({ ok: true, value: { items: [{ execution_id: "e" }] } });
    const read = ops.shellRead({ execution_id: "e" });
    t.ok(t.calls("shell.read")[0]!.id, { execution_id: "e", text: "out", output_complete: true });
    expect(await read).toMatchObject({ ok: true, value: { text: "out" } });
  });

  it.each([[4, 7, true], [5, 7, false], [4, 8, false]])("maps only valid UTF-8 stderr boundaries (%s..%s)", async (start, end, valid) => {
    const { t, ops } = setup();
    const read = ops.shellRead({ execution_id: "e", segments: true });
    t.ok(t.calls("shell.read")[0]!.id, { execution_id: "e", text: "\u{1f4a5}\u65e5", segments: [
      { stream: "stderr", start_byte: start, end_byte: end },
    ] });
    const out = await read;
    expect(out.ok && out.value.stderr).toEqual(valid ? [{ start: 2, end: 3 }] : undefined);
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
  it("rejects wrong types for cache limits, retained bytes, and process metrics while preserving explicit nulls", async () => {
    const valid = () => ({ accounting: "bounded cache accounting", caches: { body: { limit_bytes: 4096, retained_bytes: null, entries: null, unavailable_reason: "Not provided" } },
      process: { platform: "test", observed_at: "now", metrics: { private_bytes: { bytes: null, unavailable_reason: "Not provided" } } } });
    for (const mutate of [
      (v: ReturnType<typeof valid>) => { v.caches.body.limit_bytes = "4096" as never; },
      (v: ReturnType<typeof valid>) => { v.caches.body.retained_bytes = "0" as never; },
      (v: ReturnType<typeof valid>) => { v.process.metrics.private_bytes.bytes = "12" as never; },
    ]) {
      const { t, ops } = setup();
      const read = ops.memoryStatus(); const value = valid(); mutate(value);
      t.ok(t.calls("status")[0]!.id, value);
      expect(await read).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    }
    const { t, ops } = setup(); const value = valid(); const read = ops.memoryStatus(); t.ok(t.calls("status")[0]!.id, value);
    expect(await read).toMatchObject({ ok: true, value: { caches: [{ name: "body", retained: undefined, reason: "Not provided" }], metrics: [{ name: "private_bytes", bytes: undefined, reason: "Not provided" }] } });
  });

  it("memory status classifies unsupported and malformed responses at the data boundary", async () => {
    const unsupported = setup();
    const first = unsupported.ops.memoryStatus();
    const call = unsupported.t.calls("status")[0]!;
    expect(call.args).toEqual({ memory: true });
    unsupported.t.ownerError(call.id, "invalid_argument", "unknown field `memory` in the arguments of `status`", { reason: "unknown_field", name: "memory", command: "status", request_may_have_been_applied: false });
    expect(await first).toMatchObject({ ok: false, error: { kind: "owner", code: "invalid_argument" } });

    const disconnected = setup();
    const lost = disconnected.ops.memoryStatus();
    disconnected.t.ownerError(disconnected.t.calls("status")[0]!.id, "app_not_running", "Cannot connect to the owner of this data directory");
    expect(await lost).toMatchObject({ ok: false, error: { kind: "owner", code: "app_not_running" } });

    const malformed = setup();
    const second = malformed.ops.memoryStatus();
    malformed.t.ok(malformed.t.calls("status")[0]!.id, {});
    expect(await second).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it("preserves unrelated memory read errors instead of calling them invalid responses", async () => {
    const { ops } = setup();
    (ops as unknown as { run: () => Promise<unknown> }).run = async () => ({ ok: false, error: { kind: "busy", message: "synthetic" } });
    expect(await ops.memoryStatus()).toEqual({ ok: false, error: { kind: "busy", message: "synthetic" } });
  });

  it("recognizes only a definite owner admission refusal as owner busy", () => {
    const error = { kind: "owner", code: "invalid_state", message: "synthetic" } as const;
    const details = { phase: "admission", request_may_have_been_applied: false };
    expect(memoryReadIssue({ ...error, details })).toBe("owner_busy");
    expect(memoryReadIssue({ ...error, details: { ...details, request_may_have_been_applied: true } })).toBeUndefined();
    expect(memoryReadIssue({ ...error, details: { phase: "admission" } })).toBeUndefined();
    expect(memoryReadIssue({ ...error, details: { ...details, phase: "execution" } })).toBeUndefined();
  });

  it("classifies request-level connection loss separately from owner unsupported errors", () => {
    expect(memoryReadIssue({ kind: "connection_lost", message: "synthetic" })).toBe("disconnected");
    expect(memoryReadIssue({ kind: "not_connected", message: "synthetic" })).toBe("disconnected");
    expect(memoryReadIssue({ kind: "owner", code: "app_not_running", message: "synthetic" })).toBe("disconnected");
    expect(memoryReadIssue({ kind: "owner", code: "invalid_argument", message: "synthetic", details: { reason: "unknown_field", name: "memory", command: "status" } })).toBe("unsupported");
    expect(memoryReadIssue({ kind: "invalid_response", message: "synthetic" })).toBe("invalid_response");
    expect(memoryReadIssue({ kind: "busy", message: "synthetic" })).toBeUndefined();
    expect(memoryReadIssue({ kind: "owner", code: "storage_busy", message: "synthetic" })).toBeUndefined();
    expect(memoryReadIssue({ kind: "owner", code: "invalid_argument", message: "synthetic", details: { reason: "unknown_field", name: "other", command: "status" } })).toBeUndefined();
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

describe('302 optional notification across public history routes',()=>{
 const valid=[{kind:'turn_started'},{kind:'recovery_resumed'},{kind:'instructions_observed',observation:'updated'},{kind:'thread_settings_changed',changed_fields:['cwd']},{kind:'shell_ended',execution_id:'exact-exec',state:'exited',exit_code:0}];
 for(const route of ['get','window'] as const){
  it(`admits five variants and quarantines only invalid notification on history.${route}`,async()=>{
   for(const notification of [...valid,undefined,null,{kind:'future'},{kind:'turn_started',extra:'PRIVATE'}]){
    const t=new FakeTransport();const link=new Link(t);link.start();t.open();const ops=new Operations(link,()=> 'notification-case', () => true);
    const rawNode={node_id:'canonical',kind:'event',text:'body remains',selection:{ordinal:0},provenance:{sender:{kind:'system'},message:{expect_reply:false},independent:'kept',...(notification===undefined?{}:{notification})}};
    const pending=route==='get'?ops.historyGet({node_id:'canonical'}):ops.historyWindow({thread_id:'thread'});
    const response=route==='get'?rawNode:{thread_id:'thread',revision:'r',total:1,items:[rawNode]};
    t.ok(t.calls()[0]!.id,JSON.parse(JSON.stringify(response)));
    const out=await pending;expect(out.ok).toBe(true);
    if(out.ok){
     const result=route==='get'?out.value:(out.value as {items:unknown[]}).items[0];
     expect(result).toMatchObject({node_id:'canonical',text:'body remains',provenance:{sender:{kind:'system'},message:{expect_reply:false},independent:'kept'}});
     const provenance=(result as {provenance:Record<string,unknown>}).provenance;
     if(valid.includes(notification as typeof valid[number]))expect(provenance.notification).toEqual(notification);
     else expect(provenance).not.toHaveProperty('notification');
    }
    link.stop();
   }
  });
 }
});


it.each(['work','handoff'] as const)('scoped %s decoder rejects the whole foreign batch before model admission',async mode=>{
 const {t,ops}=setup();const pending=mode==='work'?ops.threadWork('selected'):ops.handoffAttempts('selected');
 const call=t.calls('status')[0]!;
 t.ok(call.id,{items:[{kind:'run',id:'current',thread_id:'selected',state:'live'},
  {kind:'attempt',id:'foreign',thread_id:'other',state:'completed',response_nodes:[{node_id:'private-foreign'}]}]});
 const out=await pending;expect(out).toMatchObject({ok:false,error:{kind:'invalid_response'}});
 expect(JSON.stringify(out)).not.toContain('private-foreign');expect(t.calls()).toHaveLength(1);
});
it.each(['work','handoff'] as const)('scoped %s decoder preserves valid operation multiplicity without inferring retired fields',async mode=>{
 const {t,ops}=setup();const pending=mode==='work'?ops.threadWork('selected'):ops.handoffAttempts('selected');
 const items=[{kind:'shell',id:'operation-a',thread_id:'selected',state:'running',execution_id:'execution-a'},
  {kind:'shell',id:'operation-b',thread_id:'selected',state:'running',execution_id:'execution-b'}];
 t.ok(t.calls('status')[0]!.id,{items});expect(await pending).toMatchObject({ok:true, ownerOperationId: "op",value:{items}});
});
it.each(['work','handoff'] as const)('scoped %s decoder keeps missing public thread identity rejected',async mode=>{
 const {t,ops}=setup();const pending=mode==='work'?ops.threadWork('selected'):ops.handoffAttempts('selected');
 t.ok(t.calls('status')[0]!.id,{items:[{kind:'run',id:'missing-scope',state:'live'}]});
 expect(await pending).toMatchObject({ok:false,error:{kind:'invalid_response'}});
});

it("binds RunGet and TurnGet observations to exact requested identities", async () => {
  const { t, ops } = setup();
  const run = ops.runGet("run-a", { threadId: "thread-a" });
  const turn = ops.turnGet("turn-a", { runId: "run-a", threadId: "thread-a" });
  expect(t.calls().map((call) => [call.command, call.args])).toEqual([
    ["run.get", { run_id: "run-a" }],
    ["turn.get", { turn_id: "turn-a" }],
  ]);
  t.ok(t.calls()[0]!.id, { run_id: "run-a", thread_id: "thread-a", state: "live", turn_id: "turn-a" });
  t.ok(t.calls()[1]!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "thread-a", state: "recovery_wait", recovery_hint: "retry" });
  await expect(run).resolves.toMatchObject({ ok: true, value: { run_id: "run-a", thread_id: "thread-a", state: "live" } });
  await expect(turn).resolves.toMatchObject({ ok: true, value: { turn_id: "turn-a", run_id: "run-a", thread_id: "thread-a", state: "recovery_wait", recovery_hint: "retry" } });
});

it("rejects foreign RunGet and TurnGet observations", async () => {
  const { t, ops } = setup();
  const run = ops.runGet("run-a");
  const turn = ops.turnGet("turn-a", { runId: "run-a", threadId: "thread-a" });
  t.ok(t.calls()[0]!.id, { run_id: "run-b", thread_id: "thread-a", state: "live" });
  t.ok(t.calls()[1]!.id, { turn_id: "turn-b", run_id: "run-a", thread_id: "thread-a", state: "recovery_wait" });
  await expect(run).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  await expect(turn).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});


it("rejects RunGet and TurnGet with wrong correlated thread or run", async () => {
  const { t, ops } = setup();
  const run = ops.runGet("run-a", { threadId: "thread-a" });
  const turn = ops.turnGet("turn-a", { runId: "run-a", threadId: "thread-a" });
  t.ok(t.calls()[0]!.id, { run_id: "run-a", thread_id: "thread-other", state: "live" });
  t.ok(t.calls()[1]!.id, { turn_id: "turn-a", run_id: "run-other", thread_id: "thread-a", state: "recovery_wait" });
  await expect(run).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  await expect(turn).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});


it("rejects malformed optional Run fields without correlation", async () => {
  const { t, ops } = setup();
  const run = ops.runGet("run-a");
  t.ok(t.calls()[0]!.id, { run_id: "run-a", thread_id: "thread-a", state: "live", recovery_hint: 7 });
  await expect(run).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});

it("rejects missing required Turn identity fields without correlation", async () => {
  const { t, ops } = setup();
  const turn = ops.turnGet("turn-a");
  t.ok(t.calls()[0]!.id, { turn_id: "turn-a", state: "recovery_wait", recovery_hint: "retry" });
  await expect(turn).resolves.toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});

it("sends Core v0.16 shell and interrupt commands with their typed protocol targets", async () => {
  const {t,ops}=setup();
  const cases=[
    ["shell.background",()=>ops.shellBackground("exec-1"),{execution_id:"exec-1"}],
    ["shell.stop",()=>ops.shellStop("exec-1"),{execution_id:"exec-1"}],
  ] as const;
  for (const [command,invoke,args] of cases) {
    const promise=invoke();
    const call=t.calls().at(-1)!;
    expect(call).toMatchObject({command,args,operation_id:expect.any(String)});
    t.ok(call.id,{});
    await expect(promise).resolves.toMatchObject({ok:true,value:{}});
  }
});


it("rejects a malformed pinned family before a positional read can use it", async () => {
  const { t, ops } = setup();
  for (const row of [{ thread_id: "a" }, { thread_id: "a", selection_revision: 3, divergence: { node_id: "n" } }]) {
    const family = ops.threadBranches({ thread_id: "a" });
    t.okRaw(t.calls().at(-1)!.id, { items: [row], limit: 200, filters: { thread_id: "a" } });
    expect(await family).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  }
});

it("requires pinned page metadata and all three reply exactness flags", async () => {
  const { t, ops } = setup();
  for (const raw of [{ items: [] }, { items: [], limit: 20, filters: { query: "unreflected" } },
    ...["awaiting_named_count_exact", "awaiting_replies_count_exact", "awaiting_thread_count_exact"].map(flag => ({
      items: [summary("a", { [flag]: undefined })], limit: 20, filters: {},
    }))]) {
    const list = ops.threadList();
    t.okRaw(t.calls().at(-1)!.id, raw);
    expect(await list).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  }
  const compact = ops.compactList({ thread_id: "a", limit: 50 });
  t.okRaw(t.calls().at(-1)!.id, { items: [], more: false, period: {}, coverage: {} });
  expect(await compact).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
