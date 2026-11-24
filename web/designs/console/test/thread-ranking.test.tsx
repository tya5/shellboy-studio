// @vitest-environment happy-dom
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
// @ts-expect-error Source witness: happy-dom does not lay out container queries.
import { readFileSync } from "node:fs";
import { fixtureModel, settle, usageItem, usagePage } from "../../../ui-core/test/fixture";
import type { DesignContext, Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { Analytics } from "../screens/Analytics";

async function mounted(incomplete = false, largeCount = false) {
  const f = await fixtureModel({ route: "analytics", section: "threads", configure(db) {
    const fallback = db.answer.bind(db);
    db.answer = call => {
      const args = call.args as { group_by?: string; cursor?: string };
      if (call.command !== "usage.get" || args.group_by !== "thread") return fallback(call);
      if (args.cursor) return { ok: true, result: { ...usagePage([
        usageItem("child", { input: 160, cached: 150, output: 10 }),
      ]), excluded_time_count: incomplete ? 1 : 0 } };
      return { ok: true, result: usagePage([
        usageItem("lead", { input: largeCount ? 10_000_120 : 120, cached: 20, output: 20, compactions: 1, summary: [30, 10, 10] }),
      ], "next") };
    };
  } });
  const host = document.body.appendChild(document.createElement("div"));
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
  const context: DesignContext = { model: f.model, designs: DESIGNS, prefs, setPrefs() {}, submitToken: async () => true };
  act(() => render(<Analytics context={context} />, host));
  return { ...f, host, done() { act(() => render(null, host)); host.remove(); f.model.dispose(); f.data.stop(); } };
}

it("ranks by the selected metric and scales only its decorative segments", async () => {
  const f = await mounted();
  try {
    const rows = () => [...f.host.querySelectorAll("table[data-compact] tbody tr")];
    const width = (row: Element) => [...row.querySelectorAll<HTMLElement>("[aria-hidden] [data-series]")].reduce((n, s) => n + parseFloat(s.style.flexBasis), 0);
    expect(rows().map(row => row.querySelector("button")?.title)).toEqual(["Improve history search", "Review query path"]);
    expect(rows()[0]!.textContent).toContain("160");
    expect(width(rows()[0]!)).toBe(100);
    expect(width(rows()[1]!)).toBe(12.5);
    act(() => [...f.host.querySelectorAll("button")].find(b => b.textContent === "Cached input")!.click());
    expect(rows().map(row => row.querySelector("button")?.title)).toEqual(["Review query path", "Improve history search"]);
    expect(width(rows()[1]!)).toBeCloseTo(100 * 20 / 150);
    expect(rows()[1]!.querySelectorAll("[aria-hidden] [data-series]")).toHaveLength(1);
    expect(rows()[1]!.querySelector("[aria-hidden] [data-series]")?.getAttribute("data-series")).toBe("1");
    expect(f.t.calls("usage.get")).toHaveLength(2);
  } finally { f.done(); }
});

it("withholds rank and share when the completed cursor walk excluded records", async () => {
  const f = await mounted(true);
  try {
    expect(f.host.textContent).toContain("Ranking unavailable");
    expect(f.host.querySelector("table[data-compact]")).toBeNull();
  } finally { f.done(); }
});

it("opens the same-period model view and restores the row on Back", async () => {
  const f = await mounted();
  try {
    act(() => f.host.querySelector<HTMLButtonElement>("table[data-compact] tbody button")!.click());
    await act(async () => { await settle(f.t, f.db); });
    const back = [...f.host.querySelectorAll("button")].find(b => b.textContent === "Back to ranking")!;
    expect(document.activeElement).toBe(back);
    expect(f.t.calls("usage.get").at(-1)?.args).toMatchObject({ group_by: "model", thread_id: "lead", since: f.model.insights.period.value.since, until: f.model.insights.period.value.until });
    act(() => back.click());
    expect((document.activeElement as HTMLElement).title).toBe("Improve history search");
  } finally { f.done(); }
});

it("keeps exact text beside the chart in the compact phone table", async () => {
  const f = await mounted(false, true);
  try {
    const table = f.host.querySelector("table[data-compact][data-center-rows]")!;
    expect(table.querySelectorAll("thead th")).toHaveLength(4);
    const value = table.querySelector("tbody tr td:nth-child(3) .cell")!;
    expect(value.textContent).toBe((10_000_160).toLocaleString());
    expect(value.childNodes).toHaveLength(1);
    expect(readFileSync("designs/console/system/components/DataTable/style.css", "utf8"))
      .toContain('.tbl[data-compact="true"] td.num .cell{white-space:nowrap;overflow-wrap:normal}');
    const label = table.querySelector(".ranked-bar-label")!;
    expect(label.firstElementChild?.textContent).toBe("Improve history search");
    expect(label.lastElementChild?.getAttribute("aria-hidden")).toBe("true");
    const css = readFileSync("designs/console/system/components/RankedBar/style.css", "utf8");
    expect(css).toMatch(/@container app \(max-width:899px\).*grid-template-columns:minmax\(0,1fr\)/);
  } finally { f.done(); }
});
