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
    const text = exportableSettings(source);
    expect(text).not.toMatch(/alice|redacted|headers/);
    const settings = parseSharedSettings(text);
    const preview = settingsPreview(settings, empty);
    expect(preview).toMatchObject({ hash: "target", added: ["proxy"], replaced: [], blocked: [] });
    expect(preview.changes).toEqual(expect.arrayContaining([
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

  it("shows overwrite and refuses to redirect an existing credential to another endpoint", () => {
    const imported = parseSharedSettings('default_model = "model-b"\n[connections.proxy]\napi = "responses"\nbase_url = "https://other.test/v1"');
    const preview = settingsPreview(imported, source);
    expect(preview.replaced).toEqual(["proxy"]);
    expect(preview.blocked).toEqual(["proxy"]);
    expect(preview.defaults).toEqual([{ field: "default_model", before: "model-a", value: "model-b" }]);
  });
});
