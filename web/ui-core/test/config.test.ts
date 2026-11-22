import { describe, expect, it } from "vitest";
import { flush, settle } from "../../data/test/harness";
import { fieldOf, isHidden } from "../src";
import { fixtureModel } from "./fixture";

const HASH = "a".repeat(64);
const values = {
  default_model: "model-a",
  default_connection: "proxy",
  connections: { proxy: { base_url: "https://proxy.example/v1", api_key_env: "PROXY_KEY", ssl_verify: true, request_timeout_ms: 60000, headers: { "X-Org": "[redacted]" } }, "my.other": { base_url: "http://x/v1/[redacted]" } },
  shell: { env: { MY_VAR: "[redacted]" } },
  limits: { data_max_bytes: 1024 },
};
const got = (over: Record<string, unknown> = {}) => ({
  config_path: "/temp/config.toml",
  loaded: { present: true, content_hash: HASH, values, redacted_fields: [], credential_env_set: { PROXY_KEY: true } },
  file: { present: true, content_hash: HASH, valid: true, error: null, values, redacted_fields: [] },
  differs: false,
  differing_fields: [],
  restart: { all_fields_require_restart: true },
  ...over,
});

async function open(answer?: (args: Record<string, unknown>) => unknown) {
  const made = await fixtureModel({ route: "settings", section: "general", capabilities: ["config.edit"] });
  const before = made.db.answer;
  let read = got();
  made.db.answer = (c) => {
    if (c.command === "config.get") return { ok: true, result: read };
    if (c.command === "config.set") {
      if (answer) return answer(c.args as Record<string, unknown>) as never;
      const hash = `${read.file.content_hash}b`;
      read = { ...read, file: { ...read.file, content_hash: hash } };
      return { ok: true, result: { written: true, content_hash: hash, restart_required: true, changes: [] } };
    }
    return before(c);
  };
  made.t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
  await settle(made.t, made.db);
  return { ...made, setRead: (r: ReturnType<typeof got>) => (read = r) };
}

describe("config editing", () => {
  it("doesn't read without the capability", async () => {
    const { t } = await fixtureModel({ route: "settings", section: "general" });
    expect(t.calls("config.get")).toHaveLength(0);
  });

  it("reads when Settings opens with the capability, and quotes field parts", async () => {
    const { model } = await open();
    expect(model.config.read.value.value?.file.contentHash).toBe(HASH);
    expect(fieldOf(["connections", "my.other", "base_url"])).toBe('connections."my.other".base_url');
  });

  it("reads the owner value once for a config mark, and ignores it outside Settings", async () => {
    const { model, t, db, setRead } = await open();
    const count = t.calls("config.get").length;
    const external = { ...values, default_model: "external-model" };
    setRead(got({ file: { ...got().file, content_hash: "b".repeat(64), values: external } }));
    t.push({ t: "changed", thread_ids: [], list: false, config_changed: false });
    await settle(t, db);
    expect(t.calls("config.get")).toHaveLength(count);
    t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    await settle(t, db);
    expect(t.calls("config.get")).toHaveLength(count + 1);
    expect(model.config.read.value.value?.file.values?.default_model).toBe("external-model");
    model.applyRoute({ view: "conversation", threadId: "lead" });
    await settle(t, db);
    t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    await settle(t, db);
    expect(t.calls("config.get")).toHaveLength(count + 1);
  });

  it("does not cancel an active read on section change and coalesces mark and resync", async () => {
    const { model, t, db } = await open();
    const before = t.calls("config.get").length;
    const cancels = t.cancels().length;
    t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    const held = t.calls("config.get").at(-1)!;
    model.applyRoute({ view: "settings", section: "connections" });
    t.push({ t: "resync" });
    t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    expect(t.calls("config.get")).toHaveLength(before + 1);
    expect(t.cancels().slice(cancels)).not.toContain(held.id);
    await settle(t, db);
    expect(t.calls("config.get")).toHaveLength(before + 2);
    model.applyRoute({ view: "settings", section: "general" });
    await settle(t, db);
    expect(t.calls("config.get")).toHaveLength(before + 2);
  });

  it("keeps a save pending on a stale expected hash after acknowledgment", async () => {
    const { model, t, db, setRead } = await open();
    const mark = () => t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    const reads = t.calls("config.get").length;
    const cancels = t.cancels().length;
    mark();
    const h0 = t.calls("config.get").at(-1)!;
    const writing = model.config.saveField(["default_model"], "model-b", "text");
    await flush();
    const write = t.calls("config.set").at(-1)!;
    db.answered.add(write.id);
    t.ok(write.id, { written: true, content_hash: "h1" });
    await writing;
    expect(t.calls("config.get")).toHaveLength(reads + 1);
    mark();
    expect(t.calls("config.get")).toHaveLength(reads + 1);
    db.answered.add(h0.id);
    t.ok(h0.id, got());
    await flush();
    expect(model.config.read.peek().value?.file.contentHash).toBe(HASH);
    expect(model.config.pendingField.peek()).toBe("default_model");
    expect(model.config.changedElsewhere.peek()).toBeUndefined();
    expect(model.config.lastSaved.peek()).toBeUndefined();
    expect(t.calls("config.get")).toHaveLength(reads + 2);
    expect(t.cancels().slice(cancels)).not.toContain(h0.id);
    setRead(got({ file: { ...got().file, content_hash: "h1", values: { ...values, default_model: "model-b" } } }));
    await settle(t, db);
    expect(model.config.pendingField.peek()).toBeUndefined();
    expect(model.config.lastSaved.peek()).toMatchObject({ hash: "h1", undo: [{ field: "default_model", value: "model-a" }] });
    expect(t.calls("config.get")).toHaveLength(reads + 2);
  });

  it.each([true, false])("settles at ACK from a prior mark read (matches save: %s)", async matches => {
    const { model, t, db, setRead } = await open();
    const reads = t.calls("config.get").length;
    const writing = model.config.saveField(["default_model"], "model-b", "text");
    await flush();
    const write = t.calls("config.set").at(-1)!;
    db.answered.add(write.id);
    const hash = matches ? "h1" : "foreign";
    setRead(got({ file: { ...got().file, content_hash: hash, values: { ...values, default_model: matches ? "model-b" : "model-c" } } }));
    t.push({ t: "changed", thread_ids: [], list: false, config_changed: true });
    await settle(t, db);
    expect(model.config.read.peek().value?.file.contentHash).toBe(hash);
    expect(model.config.pendingField.peek()).toBe("default_model");
    t.ok(write.id, { written: true, content_hash: "h1" });
    await writing;
    expect(model.config.pendingField.peek()).toBeUndefined();
    expect(t.calls("config.get")).toHaveLength(reads + 1);
    if (matches) expect(model.config.lastSaved.peek()).toMatchObject({ hash, undo: [{ field: "default_model", value: "model-a" }] });
    else expect(model.config.lastSaved.peek()).toBeUndefined();
    expect(model.config.changedElsewhere.peek()).toBe(matches ? undefined : "default_model");
  });

  it("parses each committed value without retaining a draft", async () => {
    const { model, t, db } = await open();
    const commit = async (path: string[], value: string, kind: Parameters<typeof model.config.saveField>[2]) => {
      void model.config.saveField(path, value, kind);
      await settle(t, db);
      void model.config.configChanged();
      await settle(t, db);
    };
    await commit(["limits", "data_max_bytes"], "12x", "int");
    expect(t.calls("config.set")).toHaveLength(0);
    await commit(["limits", "data_max_bytes"], "2048", "int");
    await commit(["connections", "proxy", "ssl_verify"], "false", "bool");
    await commit(["indexing", "auto_kinds"], "user,summary", "kinds");
    await commit(["compaction", "summary_max_percent"], "2.5", "float");
    await commit(["default_model"], "", "text");
    expect(t.calls("config.set").map((call) => call.args)).toEqual([
      { expected_hash: HASH, changes: [{ field: "limits.data_max_bytes", value: 2048 }] },
      { expected_hash: HASH + "b", changes: [{ field: "connections.proxy.ssl_verify", value: false }] },
      { expected_hash: HASH + "bb", changes: [{ field: "indexing.auto_kinds", value: ["user", "summary"] }] },
      { expected_hash: HASH + "bbb", changes: [{ field: "compaction.summary_max_percent", value: 2.5 }] },
      { expected_hash: HASH + "bbbb", changes: [{ field: "default_model" }] },
    ]);
  });

  it("never writes redaction placeholders or offers undo for a secret", async () => {
    const { model, t, db } = await open();
    void model.config.saveField(["shell", "env", "MY_VAR"], "[redacted]", "secret");
    await settle(t, db);
    expect(t.calls("config.set")).toHaveLength(0);
    void model.config.saveField(["shell", "env", "MY_VAR"], "synthetic-value", "secret");
    await settle(t, db);
    void model.config.configChanged();
    await settle(t, db);
    expect(model.config.lastSaved.peek()?.undo).toEqual([]);
    await model.config.undoLast();
    expect(t.calls("config.set")).toHaveLength(1);
  });

  it("tests and clears a saved connection without sending a credential", async () => {
    const made = await open();
    const before = made.db.answer;
    made.db.answer = (c) => c.command === "connection.test" ? { ok: true, result: { ok: true, models: [] } }
      : c.command === "credentials.clear" ? { ok: true, result: {} } : before(c);
    void made.model.config.testConnection("proxy");
    await settle(made.t, made.db);
    expect(made.t.calls("connection.test").at(-1)!.args).toEqual({ connection: "proxy" });
    expect(made.model.config.connectionAction.value).toEqual({ name: "proxy", state: "ok" });
    void made.model.config.clearCredential("proxy");
    await settle(made.t, made.db);
    expect(made.t.calls("credentials.clear").at(-1)!.args).toEqual({ connection: "proxy" });
    expect(made.model.config.connectionAction.value).toEqual({ name: "proxy", state: "cleared" });
  });

  it("does not write when the configuration read failed", async () => {
    const made = await open();
    const before = made.db.answer;
    made.db.answer = (c) => c.command === "config.get" ? { ok: false, code: "invalid_argument", message: "not available" } : before(c);
    void made.model.config.configChanged();
    await settle(made.t, made.db);
    expect(made.model.config.read.value.error).toBeDefined();
    void made.model.config.saveField(["default_model"], "new", "text");
    await settle(made.t, made.db);
    expect(made.t.calls("config.set")).toHaveLength(0);
  });

  it("leaving Settings cancels the read", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    void c.configChanged();
    await Promise.resolve();
    model.applyRoute({ view: "monitor" });
    await settle(t, db).catch(() => undefined);
    expect(c.read.value.loading).toBe(false);
  });
});

describe("on-the-spot config settings", () => {
  it("writes one field immediately and exposes an undo for the previous value", async () => {
    const nextHash = "b".repeat(64);
    const { model, t, db, setRead } = await open(() => ({ ok: true, result: { written: true, content_hash: nextHash, restart_required: true, changes: [{ field: "default_model", restart_required: false }] } }));
    const editor = model.config;
    const readsBefore = t.calls("config.get").length;
    void editor.saveField(["default_model"], "model-b", "text");
    await settle(t, db);
    expect(t.calls("config.set")).toHaveLength(1);
    expect(t.calls("config.set")[0]!.args).toEqual({ expected_hash: HASH, changes: [{ field: "default_model", value: "model-b" }] });
    expect(editor.lastSaved.peek()).toBeUndefined();
    expect(editor.pendingField.peek()).toBe("default_model");
    expect(t.calls("config.get")).toHaveLength(readsBefore);
    expect(editor.read.value.value?.file.values?.default_model).toBe("model-a");
    setRead(got({ file: { ...got().file, content_hash: nextHash, values: { ...values, default_model: "model-b" } } }));
    void editor.configChanged();
    await settle(t, db);
    expect(editor.lastSaved.peek()).toMatchObject({ field: "default_model", restartRequired: false, undo: [{ field: "default_model", value: "model-a" }] });
    void editor.undoLast();
    await settle(t, db);
    expect(t.calls("config.set")).toHaveLength(2);
    expect(t.calls("config.set")[1]!.args).toEqual({ expected_hash: nextHash, changes: [{ field: "default_model", value: "model-a" }] });
  });

  it("settles on a newer owner file without offering stale Undo", async () => {
    const { model, t, db, setRead } = await open(() => ({ ok: true, result: { written: true, content_hash: "ours" } }));
    const editor = model.config;
    void editor.saveField(["default_model"], "model-b", "text");
    await settle(t, db);
    expect(editor.pendingField.peek()).toBe("default_model");
    setRead(got({ file: { ...got().file, content_hash: "theirs", values: { ...values, default_model: "their-model" } } }));
    void editor.configChanged();
    await settle(t, db);
    expect(editor.pendingField.peek()).toBeUndefined();
    expect(editor.changedElsewhere.peek()).toBe("default_model");
    expect(editor.read.peek().value?.file.values?.default_model).toBe("their-model");
    await editor.undoLast();
    expect(t.calls("config.set")).toHaveLength(1);
  });

  it("clears an expected-hash conflict without rereading or retrying", async () => {
    const { model, t, db } = await open(() => ({ ok: false, code: "operation_conflict", message: "Core file changed", details: { reason: "config_changed" } }));
    const reads = t.calls("config.get").length;
    void model.config.saveField(["default_model"], "model-b", "text");
    await settle(t, db);
    expect(model.config.pendingField.peek()).toBeUndefined();
    expect(model.config.fieldError.peek()?.reason).toBe("Core file changed");
    expect(t.calls("config.get")).toHaveLength(reads);
    expect(t.calls("config.set")).toHaveLength(1);
  });

  it("keeps a refusal reason and the last published owner value without a reread", async () => {
    const { model, t, db } = await open(() => ({ ok: false, code: "invalid_argument", message: "blocked by Core policy", details: { reason: "credential_value_refused", change_index: 0, written: false } }));
    const editor = model.config as typeof model.config & {
      saveField(path: readonly string[], raw: string, kind: "text"): Promise<void>;
      fieldError: { field: string; reason: string } | undefined;
    };
    const reads = t.calls("config.get").length;
    void editor.saveField(["default_model"], "not-allowed", "text");
    await settle(t, db);
    expect(t.calls("config.get")).toHaveLength(reads);
    expect(editor.pendingField.peek()).toBeUndefined();
    expect(editor.fieldError.peek()).toEqual({ field: "default_model", reason: "blocked by Core policy" });
    expect(model.config.read.value.value?.file.values?.default_model).toBe("model-a");
  });
});
