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

async function open(answer: (args: Record<string, unknown>) => unknown = () => ({ ok: true, result: { written: true, restart_required: true, changes: [] } })) {
  const made = await fixtureModel({ route: "settings", section: "models", capabilities: ["config.edit"] });
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
    const { t } = await fixtureModel({ route: "settings", section: "models" });
    expect(t.calls("config.get")).toHaveLength(0);
  });

  it("reads when Settings opens with the capability, and quotes field parts", async () => {
    const { model } = await open();
    expect(model.config.read.value.value?.file.contentHash).toBe(HASH);
    expect(fieldOf(["connections", "my.other", "base_url"])).toBe('connections."my.other".base_url');
  });

  it("sends only the changed field, with the hash it read", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    c.edit(["default_model"], "model-b", "text");
    c.edit(["limits", "data_max_bytes"], "1024", "int");
    expect(c.changes.value.map((r) => r.field)).toEqual(["default_model"]);
    c.review();
    void c.save();
    await settle(t, db);
    expect(t.calls("config.set").at(-1)!.args).toEqual({ expected_hash: HASH, changes: [{ field: "default_model", value: "model-b" }] });
    expect(c.stage.value.kind).toBe("saved");
    expect(c.drafts.value.size).toBe(0);
  });

  it("types values: a number is sent as a number, and a bad one blocks the review", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    c.edit(["limits", "data_max_bytes"], "12x", "int");
    expect(c.hasInvalid.value).toBe(true);
    c.review();
    expect(c.stage.value.kind).toBe("editing");
    void c.save();
    await settle(t, db);
    expect(t.calls("config.set")).toHaveLength(0);
    c.edit(["limits", "data_max_bytes"], "2048", "int");
    c.edit(["connections", "proxy", "ssl_verify"], "false", "bool");
    void c.save();
    await settle(t, db);
    expect(t.calls("config.set").at(-1)!.args).toMatchObject({ changes: [{ field: "limits.data_max_bytes", value: 2048 }, { field: "connections.proxy.ssl_verify", value: false }] });
  });

  it("blank removes the key, which the review says", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    c.edit(["default_model"], "", "text");
    expect(c.changes.value[0]).toMatchObject({ removes: true, before: "model-a" });
    void c.save();
    await settle(t, db);
    expect(t.calls("config.set").at(-1)!.args).toMatchObject({ changes: [{ field: "default_model" }] });
    expect("value" in (t.calls("config.set").at(-1)!.args as { changes: object[] }).changes[0]!).toBe(false);
  });

  it("never posts the placeholder, and hidden values stay out of the review", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    expect(isHidden(values.shell.env.MY_VAR)).toBe(true);
    c.edit(["shell", "env", "MY_VAR"], "[redacted]", "secret");
    expect(c.hasInvalid.value).toBe(true);
    void c.save();
    await settle(t, db);
    expect(t.calls("config.set")).toHaveLength(0);
    c.edit(["shell", "env", "MY_VAR"], "real-synthetic", "secret");
    expect(c.hasInvalid.value).toBe(false);
    expect(JSON.stringify(c.changes.value)).not.toContain("real-synthetic");
    expect(c.changes.value[0]).toMatchObject({ sensitive: true, before: undefined, after: undefined });
    c.remove(["connections", "proxy", "headers", "X-Org"], true);
    void c.save();
    await settle(t, db);
    expect(t.calls("config.set").at(-1)!.args).toMatchObject({
      changes: [{ field: "shell.env.MY_VAR", value: "real-synthetic" }, { field: "connections.proxy.headers.X-Org" }],
    });
    expect(JSON.stringify(t.calls("config.set").at(-1)!.args)).not.toContain("[redacted");
  });

  it("a replacing draft for a hidden value doesn't vanish when it's empty, it just isn't a change", async () => {
    const { model } = await open();
    const c = model.config;
    c.edit(["shell", "env", "MY_VAR"], "x", "secret");
    c.edit(["shell", "env", "MY_VAR"], "", "secret");
    expect(c.drafts.value.size).toBe(0);
  });

  it("a stale hash reads again, keeps the drafts and writes with the new hash", async () => {
    let refused = false;
    const newHash = "b".repeat(64);
    const made = await open((): unknown => {
      if (refused) return { ok: true, result: { written: true, restart_required: true, changes: [] } };
      refused = true;
      made.setRead(got({ file: { present: true, content_hash: newHash, valid: true, error: null, values, redacted_fields: [] } }));
      return { ok: false, code: "operation_conflict", message: "changed", details: { reason: "config_changed", written: false } };
    });
    const c = made.model.config;
    c.edit(["default_model"], "model-b", "text");
    void c.save();
    await settle(made.t, made.db);
    expect(c.stage.value.kind).toBe("conflict");
    expect(c.drafts.value.size).toBe(1);
    expect(c.read.value.value?.file.contentHash).toBe(newHash);
    void c.save();
    await settle(made.t, made.db);
    expect(made.t.calls("config.set").at(-1)!.args).toMatchObject({ expected_hash: newHash });
    expect(c.stage.value.kind).toBe("saved");
  });

  it("shows the owner's refusal and names the field by index", async () => {
    const { model, t, db } = await open(() => ({ ok: false, code: "invalid_argument", message: "looks like a credential", details: { reason: "credential_value_refused", change_index: 0, written: false } }));
    const c = model.config;
    c.edit(["connections", "proxy", "api_key_env"], "ghp_abc", "name");
    void c.save();
    await settle(t, db);
    expect(c.stage.value).toMatchObject({ kind: "refused", reason: "credential_value_refused", field: "connections.proxy.api_key_env", message: "looks like a credential" });
    expect(c.drafts.value.size).toBe(1);
  });

  it("passes on a warning and the restart state from the result", async () => {
    const { model, t, db } = await open(() => ({ ok: true, result: { written: true, restart_required: true, warning: "permissions may differ", changes: [{ field: "default_model", previous: "model-a", value: "b", sensitive: false, restart_required: true }, { field: "shell.env.MY_VAR", sensitive: true, restart_required: true }] } }));
    const c = model.config;
    c.edit(["default_model"], "b", "text");
    void c.save();
    await settle(t, db);
    expect(c.stage.value).toMatchObject({ kind: "saved", restartRequired: true, warning: "permissions may differ" });
    const stage = c.stage.value as { changes: { sensitive: boolean; value?: unknown }[] };
    expect(stage.changes[1]).toEqual({ field: "shell.env.MY_VAR", sensitive: true, restartRequired: true });
  });

  it("leaving Settings cancels the read and keeps the drafts", async () => {
    const { model, t, db } = await open();
    const c = model.config;
    c.edit(["default_model"], "model-b", "text");
    void c.refresh();
    await Promise.resolve();
    model.applyRoute({ view: "monitor" });
    await settle(t, db).catch(() => undefined);
    expect(c.read.value.loading).toBe(false);
    expect(c.drafts.value.size).toBe(1);
  });
});
