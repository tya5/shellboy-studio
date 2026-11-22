import { describe, expect, it } from "vitest";
import { settle } from "../../data/test/harness";
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

async function open(answer: (args: Record<string, unknown>) => unknown = () => ({ ok: true, result: { written: true, content_hash: HASH, restart_required: true, changes: [] } })) {
  const made = await fixtureModel({ route: "settings", section: "general", capabilities: ["config.edit"] });
  const before = made.db.answer;
  let read = got();
  made.db.answer = (c) => {
    if (c.command === "config.get") return { ok: true, result: read };
    if (c.command === "config.set") return answer(c.args as Record<string, unknown>) as never;
    return before(c);
  };
  made.model.config.ensure();
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
      { expected_hash: HASH, changes: [{ field: "connections.proxy.ssl_verify", value: false }] },
      { expected_hash: HASH, changes: [{ field: "indexing.auto_kinds", value: ["user", "summary"] }] },
      { expected_hash: HASH, changes: [{ field: "compaction.summary_max_percent", value: 2.5 }] },
      { expected_hash: HASH, changes: [{ field: "default_model" }] },
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
    void made.model.config.refresh();
    await settle(made.t, made.db);
    expect(made.model.config.read.value.error).toBeDefined();
    void made.model.config.saveField(["default_model"], "new", "text");
    await settle(made.t, made.db);
    expect(made.t.calls("config.set")).toHaveLength(0);
  });

  it("leaving Settings cancels the read", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    void c.refresh();
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

  it("keeps a refusal reason on its field and rereads Core's value", async () => {
    const { model, t, db } = await open(() => ({ ok: false, code: "invalid_argument", message: "blocked by Core policy", details: { reason: "credential_value_refused", change_index: 0, written: false } }));
    const editor = model.config as typeof model.config & {
      saveField(path: readonly string[], raw: string, kind: "text"): Promise<void>;
      fieldError: { field: string; reason: string } | undefined;
    };
    void editor.saveField(["default_model"], "not-allowed", "text");
    await settle(t, db);
    expect(editor.fieldError.peek()).toEqual({ field: "default_model", reason: "blocked by Core policy" });
    expect(model.config.read.value.value?.file.values?.default_model).toBe("model-a");
  });
});
