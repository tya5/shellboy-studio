// @vitest-environment happy-dom
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { settle, summary } from "../../../data/test/harness";
import { fixtureModel } from "../../../ui-core/test/fixture";
import type { Prefs } from "../../../ui-core/src";
import { Monitor } from "../screens/Monitor";

it("shows failures outside the first Thread page in Monitor and its error count, including after resync", async () => {
  const { model, data, t, db } = await fixtureModel({ route: "monitor", configure(owner) {
    const firstPage = Array.from({ length: 50 }, (_, i) => summary(`recent-${i}`, { activity: "idle" }));
    owner.threads = Object.fromEntries(firstPage.map(row => [row.thread_id, row]));
    owner.threads.old = summary("old", { title: "Old failed Thread", state: "failed", activity: "failed" });
    const answer = owner.answer.bind(owner);
    owner.answer = call => {
      const args = call.args as { state?: string; thread_ids?: string[] };
      if (call.command === "thread.list" && !args.state && !args.thread_ids) {
        return { ok: true, result: { items: firstPage, next_cursor: "next" } };
      }
      return answer(call);
    };
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", monitorView: "cards", weights: { cached: 0.1, output: 5 } });
  const context = { model, prefs, designs: [], setPrefs: (change: Partial<Prefs>) => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  const errorCount = () => [...host.querySelectorAll("button.chip")].find(chip => chip.querySelector('[data-status="error"]'))?.querySelector("b")?.textContent;
  try {
    await act(async () => render(<Monitor context={context} />, host));
    expect(host.textContent).toContain("Old failed Thread");
    const filters = [...host.querySelectorAll("button")].find(button => button.textContent === model.t.value("monitor.filterButton"));
    expect(filters).toBeDefined();
    act(() => filters!.click());
    expect(errorCount()).toBe("1");
    db.threads.old = summary("old", { title: "Old failed Thread", state: "completed", activity: "completed" });
    db.threads.recovery = summary("recovery", { title: "Old recovery Thread", state: "recovery_wait", activity: "recovery" });
    await act(async () => { t.push({ t: "resync" }); await settle(t, db); });
    expect(host.textContent).not.toContain("Old failed Thread");
    expect(host.textContent).toContain("Old recovery Thread");
    expect(errorCount()).toBe("1");
  } finally {
    render(null, host);
    host.remove();
    model.dispose();
    data.stop();
  }
});
