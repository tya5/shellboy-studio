import { describe, expect, it } from "vitest";
import { readConfigFacts } from "../src/config";
import { exportableSettings, parseSharedSettings, settingsPreview } from "../src/settings-share";

const source = readConfigFacts({
  file: { present: true, valid: true, content_hash: "source", values: {
    default_connection: "proxy", default_model: "model-a", data_dir: "/alice/data", extra_instructions: ["/alice/AGENTS.md"],
    compaction: { summary_max_chars: 5000 }, shell: { kind: "bash", executable: "/alice/bin/sh" },
    connections: { proxy: { api: "responses", base_url: "https://example.test/v1", api_key_env: "TEAM_KEY", headers: "[redacted]", default_effort: "high", models: { include: ["model-*"], exclude: ["model-old"] } } },
  } },
});
const empty = readConfigFacts({ file: { valid: true, content_hash: "target", values: {} } });

describe("settings sharing", () => {
  it("uses Core TOML and sends only approved portable fields into a different data directory", () => {
    const { text, omitted } = exportableSettings(source);
    expect(omitted).toEqual([]);
    expect(text).not.toMatch(/alice|redacted|headers/);
    const settings = parseSharedSettings(text);
    const preview = settingsPreview(settings, empty);
    expect(preview).toMatchObject({ hash: "target", added: ["proxy"], replaced: [], warnings: [] });
    expect(preview.changes.map(({ field, value }) => ({ field, value }))).toEqual(expect.arrayContaining([
      { field: "default_connection", value: "proxy" }, { field: "default_model", value: "model-a" },
      { field: "compaction.summary_max_chars", value: 5000 }, { field: "connections.proxy.default_effort", value: "high" },
      { field: "connections.proxy.models.include", value: ["model-*"] }, { field: "connections.proxy.models.exclude", value: ["model-old"] },
      { field: "connections.proxy.api_key_env", value: "TEAM_KEY" },
    ]));
  });

  it("rejects injected credentials, urls carrying credentials and machine paths before preview", () => {
    for (const content of [
      'shell.executable = "/tmp/sh"', 'extra_instructions = ["/tmp/AGENTS.md"]', '[__proto__]\nunknown = true',
      '[connections.proxy]\napi = "responses"\nbase_url = "https://user:pass@example.test"',
      '[connections.proxy]\napi = "responses"\nbase_url = "https://example.test?token=secret"',
      '[connections.proxy]\napi = "responses"\nbase_url = "https://example.test"\nheaders = "secret"',
    ]) expect(() => parseSharedSettings(content)).toThrow();
  });

  it("previews the routing change and cleared fields without blocking a stored key overwrite", () => {
    const imported = parseSharedSettings('default_model = "model-b"\n[connections.proxy]\napi = "chat_completions"\nbase_url = "https://other.test/v1"');
    const preview = settingsPreview(imported, { ...source, file: { ...source.file, credentialSource: { proxy: "stored" } } });
    expect(preview.replaced).toEqual(["proxy"]);
    expect(preview.warnings).toEqual([{ name: "proxy", url: "https://other.test/v1", source: "stored", routing: [
      { field: "base_url", before: "https://example.test/v1", value: "https://other.test/v1" },
      { field: "api", before: "responses", value: "chat_completions" },
      { field: "api_key_header", before: undefined, value: undefined },
    ] }]);
    expect(preview.changes).toEqual(expect.arrayContaining([
      { field: "default_model", before: "model-a", value: "model-b" },
      { field: "connections.proxy.api_key_env", before: "TEAM_KEY" },
      { field: "connections.proxy.models.exclude", before: ["model-old"] },
    ]));
  });

  it("omits an unexportable connection and its default pair but preserves other connections", () => {
    const values = { ...source.file.values, default_connection: "masked", connections: {
      proxy: { api: "responses", base_url: "https://example.test/v1" },
      masked: { api: "responses", base_url: "https://example.test/%5Bredacted%5D" },
    } };
    const result = exportableSettings({ ...source, file: { ...source.file, values, redacted: ["connections.masked.base_url"] } });
    expect(result.omitted).toEqual(["masked"]);
    expect(result.text).not.toMatch(/masked|redacted|default_model/);
    expect([...parseSharedSettings(result.text).connections.keys()]).toEqual(["proxy"]);
  });
});
