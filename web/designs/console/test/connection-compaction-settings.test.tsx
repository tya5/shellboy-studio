// @vitest-environment happy-dom
import "@preact/signals";
import { afterEach, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { fixtureModel, settle } from "../../../ui-core/test/fixture";
import { render } from "preact";
import { App } from "../screens/App";
import { DESIGNS } from "../../registry";
import { loadPrefs } from "../../../ui-core/src/prefs";
import type { DesignContext, Prefs } from "../../../ui-core/src";
import { signal } from "@preact/signals-core";

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it("shows all connection summary overrides and removes numeric and spill keys when inherited", async () => {
  let values: Record<string, unknown> = {
    connections: {
      proxy: {
        api: "responses",
        base_url: "https://example.invalid/v1",
        auto_at_tokens: 24000,
        summary_max_chars: 8000,
        auto_compact_target_percent: 20,
        spill: false,
      },
    },
  };
  let hash = "initial";
  let saves = 0;
  const snapshot = () => structuredClone(values);
  const m = await fixtureModel({
    route: "settings",
    section: "connections",
    capabilities: ["config.edit"],
    configure(db) {
      const before = db.answer.bind(db);
      db.answer = (call) => {
        if (call.command === "config.get") {
          const current = snapshot();
          return { ok: true, result: { loaded: { values: current }, file: { present: true, valid: true, content_hash: hash, values: current }, differs: false } };
        }
        if (call.command === "config.set") {
          const changes = (call.args as { changes: { field: string; value?: unknown }[] }).changes;
          for (const change of changes) {
            const parts = change.field.split(".");
            let parent = values as Record<string, unknown>;
            for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
            if (change.value === undefined) delete parent[parts.at(-1)!];
            else parent[parts.at(-1)!] = change.value;
          }
          hash = `saved-${++saves}`;
          return { ok: true, result: { written: true, content_hash: hash, restart_required: true, changes: [] } };
        }
        return before(call);
      };
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  const context: DesignContext = {
    model: m.model,
    designs: DESIGNS,
    prefs: signal<Prefs>({ design: "console", theme: "console", lang: "en", monitorView: "cards", weights: { cached: 0.1, output: 5 } }),
    setPrefs: () => {},
    submitToken: async () => true,
  };
  await act(async () => { render(<App context={context} />, root); await settle(m.t, m.db); });
  dispose = () => { render(null, root); m.model.dispose(); };

  const threshold = root.querySelector<HTMLInputElement>('input[aria-label="Auto-summary threshold (tokens)"]')!;
  const summaryChars = root.querySelector<HTMLInputElement>('input[aria-label="Maximum summary characters"]')!;
  const targetPercent = root.querySelector<HTMLInputElement>('input[aria-label="Context remaining after summary (%)"]')!;
  expect([threshold.value, summaryChars.value, targetPercent.value]).toEqual(["24000", "8000", "20"]);
  expect(root.textContent).toContain("Leave blank to use the global summary-start threshold.");
  expect(root.textContent).toContain("Leave blank to use the global maximum summary length.");
  expect(root.textContent).toContain("Leave blank to use the built-in target of 20%.");
  expect(root.textContent).toContain("Inherit returns this setting to its built-in default: on.");

  const inherit = [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Inherit")!;
  act(() => inherit.click());
  await act(async () => { await settle(m.t, m.db); void m.model.config.configChanged(); await settle(m.t, m.db); });
  expect(m.t.calls("config.set")[0]!.args).toEqual({ expected_hash: "initial", changes: [{ field: "connections.proxy.spill" }] });
  expect((values.connections as Record<string, Record<string, unknown>>).proxy).not.toHaveProperty("spill");

  const refreshedThreshold = root.querySelector<HTMLInputElement>('input[aria-label="Auto-summary threshold (tokens)"]')!;
  act(() => {
    refreshedThreshold.focus();
    refreshedThreshold.value = "";
    refreshedThreshold.dispatchEvent(new Event("input", { bubbles: true }));
    refreshedThreshold.blur();
  });
  await act(async () => { await settle(m.t, m.db); void m.model.config.configChanged(); await settle(m.t, m.db); });
  expect(m.t.calls("config.set")[1]!.args).toEqual({ expected_hash: "saved-1", changes: [{ field: "connections.proxy.auto_at_tokens" }] });
  expect((values.connections as Record<string, Record<string, unknown>>).proxy).not.toHaveProperty("auto_at_tokens");
});
