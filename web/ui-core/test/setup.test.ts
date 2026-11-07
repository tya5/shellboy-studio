import { afterEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../data/test/harness";
import { formatRoute, loadPrefs, nameProblem, parseRoute, savePrefs, type PrefStore } from "../src";
import { fixtureModel } from "./fixture";

const KEY = "sk-test-SECRET-0123456789";
const HASH = "b".repeat(64);
const MODELS = ["model-a", "model-b"];

const fileWith = (values: Record<string, unknown> | undefined) => ({
  config_path: "/temp/cfg/config.toml",
  loaded: { present: values !== undefined, content_hash: HASH, values, redacted_fields: [], credential_env_set: {} },
  file: { present: values !== undefined, content_hash: HASH, valid: true, error: null, values, redacted_fields: [] },
  differs: false,
  differing_fields: [],
  restart: { all_fields_require_restart: true },
});

type Answer = { ok: true; result: unknown } | { ok: false; code: string; message?: string };
interface Fake {
  values?: Record<string, unknown> | undefined;
  /** Environment variables the fake owner has. */
  env?: string[];
  /** The provider's reply to the model-list GET, from the candidate. */
  provider?: (candidate: Record<string, unknown>) => Record<string, unknown>;
  credentials?: (args: Record<string, unknown>) => Answer;
  configSet?: (args: Record<string, unknown>) => Answer;
}

const okTest = (candidate: Record<string, unknown>, env: string[]) => ({
  http_status: 200,
  models: MODELS,
  ...(typeof candidate.api_key_env === "string" ? { api_key_env: { name: candidate.api_key_env, set: env.includes(candidate.api_key_env) } } : {}),
  failure: null,
});

type Made = Awaited<ReturnType<typeof fixtureModel>>;

async function open(fake: Fake = {}, route: "conversation" | "setup" = "setup"): Promise<Made> {
  const env = fake.env ?? [];
  return fixtureModel({
    route,
    capabilities: ["config.edit", "connection.setup"],
    configure(db) {
      const before = db.answer.bind(db);
      db.answer = (c) => {
        const args = (c.args ?? {}) as Record<string, unknown>;
        if (c.command === "config.get") return { ok: true, result: fileWith("values" in fake ? fake.values : {}) };
        if (c.command === "connection.test") return { ok: true, result: (fake.provider ?? ((a) => okTest(a, env)))(args) };
        if (c.command === "credentials.set") return fake.credentials ? fake.credentials(args) : { ok: true, result: { path: "/temp/cfg/credentials.toml" } };
        if (c.command === "config.set") return fake.configSet ? fake.configSet(args) : { ok: true, result: { written: true, restart_required: true, changes: [] } };
        return before(c);
      };
    },
  });
}

/** Let the fake owner answer until the operation under test finishes. */
async function run<T>(made: Made, work: Promise<T>): Promise<T> {
  let done = false;
  const result = work.finally(() => (done = true));
  for (let i = 0; i < 50 && !done; i++) await settle(made.t, made.db);
  return result;
}

const wire = (t: { calls(c?: string): { args?: unknown }[] }, command: string) => t.calls(command).map((c) => c.args as Record<string, unknown>);

afterEach(() => vi.restoreAllMocks());

describe("showing the screen", () => {
  it("opens by itself once when the file has no connection, and only then", async () => {
    const m = await open({ values: {} }, "conversation");
    await settle(m.t, m.db);
    expect(m.model.route.value.view).toBe("setup");
    m.model.navigate({ view: "conversation" });
    await settle(m.t, m.db);
    expect(m.model.route.value.view).toBe("conversation");
  });

  it("stays away when a connection exists, and when the owner lacks the capability", async () => {
    const withConn = await open({ values: { connections: { proxy: { base_url: "http://x/v1" } } } }, "conversation");
    await settle(withConn.t, withConn.db);
    expect(withConn.model.route.value.view).toBe("conversation");
    const old = await fixtureModel();
    expect(old.t.calls("config.get")).toHaveLength(0);
    expect(old.t.calls("connection.test")).toHaveLength(0);
    expect(old.model.route.value.view).toBe("conversation");
  });

  it("stays away when the file can't be read", async () => {
    const m = await fixtureModel({
      capabilities: ["connection.setup"],
      configure: (db) => {
        const before = db.answer.bind(db);
        db.answer = (c) => (c.command === "config.get" ? { ok: false, code: "config_invalid", message: "bad file" } : before(c));
      },
    });
    expect(m.model.setup.probe.value.state).toBe("unreadable");
    expect(m.model.route.value.view).toBe("conversation");
  });
});

describe("the flow", () => {
  async function ready(fake: Fake = {}) {
    const m = await open({ values: {}, ...fake });
    await settle(m.t, m.db);
    return m;
  }

  it("lets a preset's address and format change, and forgets what the variable offered", async () => {
    const m = await ready({ env: ["ANTHROPIC_API_KEY"] });
    const { t } = m;
    const s = m.model.setup;
    s.choose("anthropic");
    await settle(t, m.db);
    expect(s.env.value.kind).toBe("offered");
    const asked = wire(t, "connection.test").length;
    s.editConnection();
    s.setBaseUrl("https://proxy.example/v1");
    s.setApi("chat_completions");
    await settle(t, m.db);
    expect(s.env.value.kind).toBe("declined");
    // The environment's key isn't sent to the typed address.
    expect(wire(t, "connection.test").length).toBe(asked);
    s.setKeyDraft(KEY);
    await run(m, s.runTest());
    expect(wire(t, "connection.test").at(-1)).toMatchObject({ base_url: "https://proxy.example/v1", api: "chat_completions", api_key: KEY });
    expect(wire(t, "connection.test").at(-1)).not.toHaveProperty("api_key_env");
  });

  it("offers the owner's variable once and saves without storing a key", async () => {
    const m = await ready({ env: ["ANTHROPIC_API_KEY"] });
    const { t } = m;
    const s = m.model.setup;
    s.choose("anthropic");
    await settle(t, m.db);
    expect(wire(t, "connection.test")[0]).toEqual({ base_url: "https://api.anthropic.com/v1", api: "anthropic_messages", api_key_header: "x-api-key", api_key_env: "ANTHROPIC_API_KEY" });
    expect(s.env.value.kind).toBe("offered");
    s.useEnv();
    expect(s.test.value.kind).toBe("ok");
    expect(s.models.value).toEqual(MODELS);
    s.setModel("model-b");
    await run(m, s.save());
    expect(t.calls("credentials.set")).toHaveLength(0);
    expect(wire(t, "config.set").at(-1)).toEqual({
      expected_hash: HASH,
      changes: [
        { field: "connections.anthropic.base_url", value: "https://api.anthropic.com/v1" },
        { field: "connections.anthropic.api", value: "anthropic_messages" },
        { field: "connections.anthropic.api_key_env", value: "ANTHROPIC_API_KEY" },
        { field: "connections.anthropic.api_key_header", value: "x-api-key" },
        { field: "default_connection", value: "anthropic" },
        { field: "default_model", value: "model-b" },
      ],
    });
    const done = s.saveState.value;
    expect(done.kind === "saved" && done.usesStoredKey).toBe(false);
  });

  it("declining the offered variable asks for a key and doesn't offer again", async () => {
    const m = await ready({ env: ["OPENAI_API_KEY"] });
    const s = m.model.setup;
    s.choose("openai");
    await settle(m.t, m.db);
    expect(s.env.value.kind).toBe("offered");
    s.declineEnv();
    expect(s.env.value.kind).toBe("declined");
    s.useEnv();
    expect(s.env.value.kind).toBe("declined");
  });

  it("asks for a key when the variable is absent, sends it, clears the field and stores it on save", async () => {
    const m = await ready({ env: [] });
    const { t } = m;
    const s = m.model.setup;
    s.choose("openai");
    await settle(t, m.db);
    expect(s.env.value.kind).toBe("absent");
    s.setKeyDraft(KEY);
    await run(m, s.runTest());
    expect(wire(t, "connection.test").at(-1)).toEqual({ base_url: "https://api.openai.com/v1", api: "responses", api_key: KEY });
    expect(s.keyDraft.value).toBe("");
    expect(s.keyHeld.value).toBe(true);
    expect(s.test.value.kind).toBe("ok");
    s.setModel("model-a");
    await run(m, s.save());
    expect(wire(t, "credentials.set")).toEqual([{ connection: "openai", value: KEY }]);
    expect(s.saveState.value).toMatchObject({ kind: "saved", usesStoredKey: true, keyPath: "/temp/cfg/credentials.toml", restart: "required" });
    expect(s.keyHeld.value).toBe(false);
    // No variable name: at each request it would win over the key the person just gave.
    expect((wire(t, "config.set").at(-1)!.changes as { field: string }[]).map((c) => c.field)).not.toContain("connections.openai.api_key_env");
  });

  it("reports each failure class as facts, and drops a rejected key only", async () => {
    const cases: [Record<string, unknown>, string, number | undefined][] = [
      [{ http_status: 401, models: [], failure: { class: "auth", message: "invalid x-api-key" } }, "auth", 401],
      [{ http_status: 404, models: [], failure: { class: "url" } }, "url", 404],
      [{ models: [], failure: { class: "unreachable", message: "connection refused" } }, "unreachable", undefined],
      [{ http_status: 200, models: [], failure: null }, "empty", 200],
      [{ http_status: 418, models: [], failure: { class: "something_new" } }, "other", 418],
    ];
    for (const [reply, failure, status] of cases) {
      const m = await ready({ provider: () => reply });
      const s = m.model.setup;
      s.choose("other");
      s.setBaseUrl("https://gateway.example/v1");
      s.setKeyDraft(KEY);
      await run(m, s.runTest());
      expect(s.test.value).toMatchObject({ kind: "failed", failure, status });
      expect(s.canSave.value).toBe(false);
      expect(s.keyHeld.value).toBe(failure !== "auth");
    }
  });

  it("a test that can't run is an error, not a verdict on the key", async () => {
    const m = await ready();
    const before = m.db.answer.bind(m.db);
    m.db.answer = (c) => (c.command === "connection.test" ? { ok: false, code: "owner_busy", message: "try later" } : before(c));
    const s = m.model.setup;
    s.choose("local");
    await run(m, s.runTest());
    expect(s.test.value).toEqual({ kind: "error", message: "try later" });
  });

  it("Local sends nothing until the address is confirmed, probes no port and needs no key", async () => {
    const m = await ready();
    const { t } = m;
    const s = m.model.setup;
    s.choose("local");
    await settle(t, m.db);
    expect(t.calls("connection.test")).toHaveLength(0);
    expect(s.baseUrl.value).toBe("http://localhost:11434/v1");
    s.setBaseUrl("http://localhost:8080/v1");
    expect(s.canTest.value).toBe(true);
    await run(m, s.runTest());
    expect(wire(t, "connection.test")).toEqual([{ base_url: "http://localhost:8080/v1", api: "chat_completions" }]);
    s.setModel("llama");
    await run(m, s.save());
    expect(t.calls("credentials.set")).toHaveLength(0);
    const fields = (wire(t, "config.set").at(-1)!.changes as { field: string }[]).map((c) => c.field);
    expect(fields).not.toContain("connections.local.api_key_env");
  });

  it("guesses no model: saving needs a chosen or typed one", async () => {
    const m = await ready({ env: [] });
    const s = m.model.setup;
    s.choose("local");
    await run(m, s.runTest());
    expect(s.model.value).toBe("");
    expect(s.canSave.value).toBe(false);
    s.setModel("  ");
    expect(s.canSave.value).toBe(false);
    s.setModel("model-a");
    expect(s.canSave.value).toBe(true);
  });

  it("says plainly whether a restart is needed, from the owner's own report", async () => {
    for (const [reported, expected] of [[true, "required"], [false, "none"], [undefined, "unreported"]] as const) {
      const m = await ready({ configSet: () => ({ ok: true, result: { written: true, ...(reported !== undefined && { restart_required: reported }) } }) });
      const s = m.model.setup;
      s.choose("local");
      await run(m, s.runTest());
      s.setModel("m");
      await run(m, s.save());
      expect(s.saveState.value).toMatchObject({ kind: "saved", restart: expected });
    }
  });

  it("retains the uncommitted key when the configuration write fails", async () => {
    let failures = 1;
    const m = await ready({ configSet: () => (failures-- > 0 ? { ok: false, code: "write_failed", message: "disk is read-only" } : { ok: true, result: { restart_required: true } }) });
    const s = m.model.setup;
    s.choose("other");
    s.setBaseUrl("https://gateway.example/v1");
    s.setKeyDraft(KEY);
    await run(m, s.runTest());
    s.setModel("m");
    await run(m, s.save());
    expect(s.saveState.value).toMatchObject({ kind: "failed", message: "disk is read-only", keyStored: false });
    await run(m, s.save());
    expect(s.saveState.value.kind).toBe("saved");
    expect(m.t.calls("credentials.set")).toHaveLength(1);
  });

  it("reports a key storage failure after creating the connection", async () => {
    const m = await ready({ credentials: () => ({ ok: false, code: "credentials_write_failed", message: "no space" }) });
    const s = m.model.setup;
    s.choose("other");
    s.setBaseUrl("https://gateway.example/v1");
    s.setKeyDraft(KEY);
    await run(m, s.runTest());
    s.setModel("m");
    await run(m, s.save());
    expect(s.saveState.value).toMatchObject({ kind: "failed", keyStored: false });
    expect(m.t.calls("config.set")).toHaveLength(1);
  });

  it("reads again and retries once when the file changed under it", async () => {
    let conflicts = 1;
    const m = await ready({ configSet: () => (conflicts-- > 0 ? { ok: false, code: "operation_conflict" } : { ok: true, result: { restart_required: true } }) });
    const s = m.model.setup;
    s.choose("local");
    await run(m, s.runTest());
    s.setModel("m");
    await run(m, s.save());
    expect(m.t.calls("config.set")).toHaveLength(2);
    expect(s.saveState.value.kind).toBe("saved");
  });

  it("names a second connection apart from an existing one", async () => {
    const m = await ready({ values: { connections: { anthropic: { base_url: "x" } } } });
    m.model.setup.choose("anthropic");
    expect(m.model.setup.connectionName.value).toBe("anthropic-2");
  });

  it("changing the service or address forgets the earlier test, and the key goes with the service", async () => {
    const m = await ready({ env: [] });
    const s = m.model.setup;
    s.choose("other");
    s.setBaseUrl("https://a.example/v1");
    s.setKeyDraft(KEY);
    await run(m, s.runTest());
    expect(s.test.value.kind).toBe("ok");
    s.setBaseUrl("https://b.example/v1");
    expect(s.test.value.kind).toBe("idle");
    expect(s.keyHeld.value).toBe(true);
    s.choose("local");
    expect(s.keyHeld.value).toBe(false);
  });
});

describe("the key stays out of sight", () => {
  it("never reaches stored preferences, logs, signals or errors", async () => {
    const logs: unknown[][] = [];
    for (const name of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, name).mockImplementation((...a: unknown[]) => void logs.push(a));
    const m = await open({ values: {}, env: [], configSet: () => ({ ok: false, code: "write_failed", message: "no" }) });
    await settle(m.t, m.db);
    const s = m.model.setup;
    s.choose("openai");
    await settle(m.t, m.db);
    s.setKeyDraft(KEY);
    await run(m, s.runTest());
    s.setModel("model-a");
    await run(m, s.save());
    expect(s.saveState.value.kind).toBe("failed");

    let stored = "";
    const store: PrefStore = { read: () => (stored === "" ? null : stored), write: (v) => (stored = v) };
    savePrefs(store, loadPrefs(store, [{ name: "console", themes: [{ name: "console" }] }]));
    expect(stored).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY);
    for (const sig of [s.probe, s.service, s.baseUrl, s.api, s.keyDraft, s.keyHeld, s.env, s.test, s.model, s.saveState, m.model.actionError, m.model.config.read, m.model.config.drafts, m.model.config.stage])
      expect(String(JSON.stringify(sig.value, (_k, v: unknown) => (v instanceof Map ? [...v] : v)))).not.toContain(KEY);
    // The key travelled only in the two calls that carry it.
    const carrying = m.t.calls().filter((c) => JSON.stringify(c.args ?? {}).includes(KEY)).map((c) => c.command);
    expect(carrying).toEqual(["connection.test"]);
  });
});

const FILE = {
  default_connection: "proxy",
  default_model: "m0",
  connections: {
    proxy: { base_url: "http://localhost:4000/v1", api: "chat_completions", api_key_env: "LITELLM_API_KEY" },
    claude: { base_url: "https://api.anthropic.com/v1", api: "anthropic_messages", api_key_env: "ANTHROPIC_API_KEY", api_key_header: "x-api-key" },
    litellm: { base_url: "http://localhost:4000/v1", api: "chat_completions", api_key_env: "LITELLM_API_KEY" },
  },
};
const fields = (t: Made["t"]) => (wire(t, "config.set").at(-1)!.changes as { field: string; value?: unknown }[]);

describe("several connections", () => {
  async function ready(fake: Fake = {}) {
    const m = await open({ values: FILE, ...fake });
    await settle(m.t, m.db);
    return m;
  }

  it("prefills a free name, and a typed existing name needs a confirmation before saving", async () => {
    const m = await ready();
    const s = m.model.setup;
    s.choose("litellm");
    expect(s.connectionName.value).toBe("litellm-2");
    expect(s.replaces.value).toBe(false);
    s.choose("local");
    s.setName("litellm");
    expect(s.replaces.value).toBe(true);
    await run(m, s.runTest());
    s.setModel("m");
    expect(s.canSave.value).toBe(false);
    await run(m, s.save());
    expect(m.t.calls("config.set")).toHaveLength(0);
    s.setConfirmReplace(true);
    expect(s.canSave.value).toBe(true);
    // Typing another name takes the confirmation back.
    s.setName("litellm-3");
    expect(s.replaces.value).toBe(false);
    s.setName("litellm");
    expect(s.confirmReplace.value).toBe(false);
  });

  it("a replacement drops the old variable and header it no longer writes", async () => {
    const m = await ready();
    const s = m.model.setup;
    s.choose("local");
    s.setName("claude");
    s.setConfirmReplace(true);
    await run(m, s.runTest());
    s.setModel("m");
    await run(m, s.save());
    const changes = fields(m.t);
    expect(changes).toContainEqual({ field: "connections.claude.base_url", value: "http://localhost:11434/v1" });
    expect(changes).toContainEqual({ field: "connections.claude.api_key_env" });
    expect(changes).toContainEqual({ field: "connections.claude.api_key_header" });
    expect(changes.filter((c) => c.field.endsWith("api_key_env"))[0]).not.toHaveProperty("value");
    expect(s.saveState.value).toMatchObject({ kind: "saved", replaced: true });
  });

  it("a new name leaves the others alone", async () => {
    const m = await ready();
    const s = m.model.setup;
    s.choose("local");
    s.setName("local-b");
    await run(m, s.runTest());
    await run(m, s.save());
    expect(fields(m.t).every((c) => c.field.startsWith("connections.local-b."))).toBe(true);
    expect(fields(m.t).filter((c) => c.value === undefined)).toEqual([]);
  });

  it("checks the name against what the owner takes", () => {
    expect(nameProblem("")).toBe("empty");
    expect(nameProblem("my proxy")).toBe("chars");
    expect(nameProblem("my.proxy")).toBe("chars");
    expect(nameProblem("プロキシ")).toBe("chars");
    expect(nameProblem("a".repeat(65))).toBe("long");
    expect(nameProblem("sk-abcdefghijklmnop1234")).toBe("credential");
    expect(nameProblem("litellm-2")).toBeUndefined();
    expect(nameProblem("Work_proxy")).toBeUndefined();
  });

  it("a bad name blocks the save and is never written", async () => {
    const m = await ready();
    const s = m.model.setup;
    s.choose("local");
    await run(m, s.runTest());
    s.setModel("m");
    s.setName("a.b");
    expect(s.nameProblem.value).toBe("chars");
    expect(s.canSave.value).toBe(false);
    s.setName("   ");
    expect(s.nameProblem.value).toBe("empty");
  });

  it("makes the new connection the default only when there is none, or when asked", async () => {
    const withDefault = await ready();
    const a = withDefault.model.setup;
    a.choose("local");
    expect(a.makeDefault.value).toBe(false);
    await run(withDefault, a.runTest());
    // No model is needed when the default stays.
    expect(a.canSave.value).toBe(true);
    await run(withDefault, a.save());
    expect(fields(withDefault.t).map((c) => c.field)).not.toContain("default_connection");
    expect(fields(withDefault.t).map((c) => c.field)).not.toContain("default_model");
    expect(a.saveState.value).toMatchObject({ kind: "saved", madeDefault: false });

    const asked = await ready();
    const b = asked.model.setup;
    b.choose("local");
    b.setMakeDefault(true);
    expect(b.canSave.value).toBe(false);
    await run(asked, b.runTest());
    expect(b.canSave.value).toBe(false);
    b.setModel("m");
    await run(asked, b.save());
    expect(fields(asked.t)).toContainEqual({ field: "default_connection", value: "local" });
    expect(fields(asked.t)).toContainEqual({ field: "default_model", value: "m" });

    const none = await ready({ values: { connections: { proxy: { base_url: "x", api: "chat_completions" } } } });
    none.model.setup.choose("local");
    expect(none.model.setup.makeDefault.value).toBe(true);
  });
});

describe("embedding (optional)", () => {
  async function ready(fake: Fake = {}) {
    const m = await open({ values: FILE, ...fake });
    await settle(m.t, m.db);
    return m;
  }

  it("offers the existing connections and takes the model list from connection.test for the chosen one", async () => {
    const m = await ready();
    const e = m.model.embedding;
    expect(e.connections.value).toEqual(["proxy", "claude", "litellm"]);
    e.choose("proxy");
    await settle(m.t, m.db);
    expect(wire(m.t, "connection.test").at(-1)).toEqual({ connection: "proxy" });
    expect(e.models.value).toEqual(MODELS);
    // No guess: nothing is chosen, and any ID can be typed.
    expect(e.modelDraft.value).toBe("");
    expect(e.canSave.value).toBe(false);
    e.setModel("my-own-embedding-id");
    expect(e.canSave.value).toBe(true);
  });

  it("writes embedding.connection and embedding.model together, and sends no embeddings request", async () => {
    const m = await ready();
    const e = m.model.embedding;
    e.choose("proxy");
    await settle(m.t, m.db);
    e.setModel("embed-small");
    await run(m, e.save());
    expect(wire(m.t, "config.set")).toEqual([{ expected_hash: HASH, changes: [{ field: "embedding.connection", value: "proxy" }, { field: "embedding.model", value: "embed-small" }] }]);
    expect(e.saveState.value).toMatchObject({ kind: "saved", change: "on", restart: "required" });
    expect(m.model.setup.probe.value).toMatchObject({ state: "ready", embedding: { connection: "proxy", model: "embed-small" } });
    // Nothing but reading the file, the model-list GET and the write.
    expect(m.t.calls().some((c) => /embed|index\.|rag/.test(c.command) || JSON.stringify(c.args ?? {}).includes("/embeddings"))).toBe(false);
  });

  it("says Anthropic has no embeddings from the dialect's data, asks for another connection and writes nothing", async () => {
    const m = await ready();
    const e = m.model.embedding;
    const asked = wire(m.t, "connection.test").length;
    e.choose("claude");
    await settle(m.t, m.db);
    expect(e.unsupported.value).toBe(true);
    expect(wire(m.t, "connection.test").length).toBe(asked);
    e.setModel("whatever");
    expect(e.canSave.value).toBe(false);
    await run(m, e.save());
    expect(m.t.calls("config.set")).toHaveLength(0);
    e.choose("proxy");
    expect(e.unsupported.value).toBe(false);
  });

  it("turns off by removing both fields, with no value in the change", async () => {
    const m = await ready({ values: { ...FILE, embedding: { connection: "proxy", model: "embed-small" } } });
    const e = m.model.embedding;
    expect(e.current.value).toEqual({ connection: "proxy", model: "embed-small" });
    await run(m, e.turnOff());
    const changes = fields(m.t);
    expect(changes).toEqual([{ field: "embedding.connection" }, { field: "embedding.model" }]);
    for (const c of changes) expect(c).not.toHaveProperty("value");
    expect(e.saveState.value).toMatchObject({ kind: "saved", change: "off" });
    expect(e.current.value).toBeUndefined();
  });

  it("reports a refused write and retries once on a conflict", async () => {
    let step = 0;
    const m = await ready({ configSet: () => (step++ === 0 ? { ok: false, code: "operation_conflict" } : step === 2 ? { ok: false, code: "config_invalid", message: "embedding.connection must reference a configured connection" } : { ok: true, result: {} }) });
    const e = m.model.embedding;
    e.choose("proxy");
    await settle(m.t, m.db);
    e.setModel("x");
    await run(m, e.save());
    expect(m.t.calls("config.set")).toHaveLength(2);
    expect(e.saveState.value).toMatchObject({ kind: "failed" });
  });

  it("returns from adding another connection with the new one chosen", async () => {
    const m = await ready();
    const e = m.model.embedding;
    e.startAdd();
    expect(e.returning.value).toBe(true);
    const s = m.model.setup;
    s.choose("local");
    await run(m, s.runTest());
    const name = s.connectionName.value;
    await run(m, s.save());
    e.comeBack(name);
    expect(e.connection.value).toBe("local");
    expect(e.connections.value).toContain("local");
    expect(e.returning.value).toBe(false);
  });

  it("has a route of its own", () => {
    expect(parseRoute("#/setup/embedding")).toEqual({ view: "setup", step: "embedding" });
    expect(parseRoute("#/setup")).toEqual({ view: "setup" });
    expect(formatRoute({ view: "setup", step: "embedding" })).toBe("#/setup/embedding");
  });
});
