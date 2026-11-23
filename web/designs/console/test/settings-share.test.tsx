// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { details } from "../../../data/test/harness";
import { fixtureModel, settle } from "../../../ui-core/test/fixture";
import { readConfigFacts } from "../../../ui-core/src/config";
import { exportableSettings } from "../../../ui-core/src/settings-share";
import { parseRoute } from "../../../ui-core/src/route";
import { SettingsShare } from "../screens/SettingsShare";

it("imports an exported profile into a fresh synthetic owner, waits for confirmation, then stores a key and opens a conversation", async () => {
  const profile = { default_connection: "proxy", default_model: "chat", connections: { proxy: { api: "chat_completions", base_url: "https://proxy.example.test/v1", api_key_env: "TEAM_KEY", models: { include: ["chat"] } } } };
  const text = exportableSettings(readConfigFacts({ file: { valid: true, content_hash: "source", values: { ...profile, data_dir: "/fixture/source" } } }));
  let hash = "fresh", values: Record<string, unknown> = {}, sources: Record<string, string> = {};
  const f = await fixtureModel({ capabilities: ["config.edit", "history.window"], configure(db) {
    const other = db.answer.bind(db);
    db.answer = call => {
      switch (call.command) {
        case "config.get": return { ok: true, result: { config_path: "/fixture/target/config.toml", file: { present: hash !== "fresh", valid: true, content_hash: hash, values, credential_source: sources }, loaded: { values, credential_source: sources } } };
        case "config.set": hash = "imported"; values = profile; sources = { proxy: "none" }; return { ok: true, result: { written: true, content_hash: hash, changes: [] } };
        case "credentials.set": sources = { proxy: "stored" }; return { ok: true, result: { connection: "proxy", stored: true, replaced: false, key_source: "stored", credentials_path: "/fixture/target/credentials.toml", permissions_tightened: false, changed_by: null } };
        case "thread.create": return { ok: true, result: details("lead") };
        default: return other(call);
      }
    };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const select = (caption: string) => [...host.querySelectorAll("button")].find(b => b.textContent === caption)!;
  const step = (work: () => void) => act(async () => { work(); await settle(f.t, f.db); });
  try {
    await step(() => { f.model.applyRoute({ view: "setup", step: "share" }); render(<SettingsShare model={f.model} firstRun />, host); });
    const picker = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(picker, "files", { value: [new File([text], "shared.toml", { type: "application/toml" })] });
    await step(() => picker.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.textContent).toContain("Adds connections: proxy");
    expect(host.textContent).toContain("default_model: — → chat");
    expect(f.t.calls("config.set")).toHaveLength(0);
    await step(() => select("Apply settings").click());
    expect(f.t.calls("config.set")[0]?.args).toMatchObject({ expected_hash: "fresh", changes: expect.arrayContaining([{ field: "connections.proxy.api_key_env", value: "TEAM_KEY" }]) });
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await step(() => f.t.push({ t: "changed", config_changed: true, thread_ids: [], list: false }));
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(key).not.toBeNull();
    key.value = "fixture-key";
    await step(() => key.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(f.t.calls("credentials.set")[0]?.args).toEqual({ connection: "proxy", value: "fixture-key" });
    expect(key.value).toBe("");
    const start = host.querySelector('a[href="#/conversation"]');
    expect(start?.textContent).toBe("Start a conversation");
    await act(async () => { f.model.applyRoute(parseRoute(start!.getAttribute("href")!)); void f.model.createThread(); await settle(f.t, f.db); });
    expect(f.t.calls("thread.create")).toHaveLength(1);
    expect(f.model.route.value.view).toBe("conversation");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});
