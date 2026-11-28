// @vitest-environment happy-dom
// #105: Awaiting you keeps loaded question pages, re-reads them on a hint without
// losing a draft, shows a lower-bound count, and names Threads outside the list.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { pendingReply, settle, summary } from "../../../data/test/harness";
import type { DesignContext, Prefs, AppModel } from "../../../ui-core/src";
import { HUMAN_PAGE_LIMIT } from "../../../data/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";

let host: HTMLElement | undefined;
afterEach(() => { if (host) render(null, host); host?.remove(); host = undefined; });

function draw(model: AppModel) {
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
  const context: DesignContext = { model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  host = document.createElement("div"); document.body.append(host);
  act(() => render(<App context={context} />, host!));
  return host;
}
const questions = (n: number, thread = "lead") => Array.from({ length: n }, (_, i) => pendingReply(`q${String(i).padStart(2, "0")}`, thread, { kind: "name", name: "human" }, `Question ${i}`));
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>(".inbox .qitem")];
const badge = (el: HTMLElement) => el.querySelector(".nav-item[href*='inbox'] .count")?.textContent;
const moreButton = (el: HTMLElement, model: AppModel) => [...el.querySelectorAll<HTMLButtonElement>(".inbox button")].find(b => b.textContent === model.t.value("inbox.more"));
const humanReads = (calls: { command: string; args?: unknown }[]) => calls.filter(c => c.command === "message.list" && (c.args as { to?: string }).to === "human");

it("Show more keeps the earlier questions and the badge marks the loaded count as a lower bound", async () => {
  const { model, t, db } = await fixtureModel({ route: "inbox", realPending: true, configure: db => { db.replies = questions(20); } });
  try {
    const el = draw(model);
    expect(rows(el)).toHaveLength(16);
    expect(badge(el)).toBe("16+");
    expect(el.querySelector(".inbox .qlist .group-label")?.textContent).toBe(`${model.t.value("inbox.questions")} 16+`);
    await act(async () => { moreButton(el, model)!.click(); await settle(t, db); });
    expect(rows(el).map(r => r.textContent?.match(/Question \d+/)?.[0])).toEqual(questions(20).map(q => q.excerpt));
    expect(badge(el)).toBe("20");
    expect(moreButton(el, model)).toBeUndefined();
  } finally { model.dispose(); }
});

it("shows a lower bound on pressure and retries the offered continuation", async () => {
  const { model, t, db } = await fixtureModel({ route: "inbox", realPending: true, configure: db => { db.replies = questions(20); } });
  try {
    const el = draw(model);
    const budget = model.data.retainedBudget;
    budget.setLimit(budget.usage.peek().used);
    await act(async () => { moreButton(el, model)!.click(); await settle(t, db); });
    expect(rows(el)).toHaveLength(HUMAN_PAGE_LIMIT);
    expect(badge(el)).toBe(`${HUMAN_PAGE_LIMIT}+`);
    expect(el.textContent).toContain(model.t.value("inbox.capped"));
    budget.setLimit(64 * 1024 * 1024);
    await act(async () => { moreButton(el, model)!.click(); await settle(t, db); });
    expect(humanReads(t.calls()).slice(-2).map(call => (call.args as { cursor?: string }).cursor)).toEqual(["16", "16"]);
    expect(rows(el)).toHaveLength(20);
    expect(badge(el)).toBe("20");
    expect(moreButton(el, model)).toBeUndefined();
  } finally { model.dispose(); }
});

it("a hint re-reads the loaded pages, stays on them and keeps a half-written answer", async () => {
  const { model, t, db } = await fixtureModel({ route: "inbox", realPending: true, configure: db => { db.replies = questions(20); } });
  try {
    const el = draw(model);
    await act(async () => { moreButton(el, model)!.click(); await settle(t, db); });
    act(() => { rows(el).find(r => r.textContent?.includes("Question 18"))!.click(); });
    const box = el.querySelector<HTMLTextAreaElement>(".qdetail textarea")!;
    act(() => { box.value = "half-written"; box.dispatchEvent(new Event("input", { bubbles: true })); });
    const before = humanReads(t.calls()).length;
    await act(async () => { t.push({ t: "changed", thread_ids: [], list: true, config_changed: false }); await settle(t, db); });
    const reread = humanReads(t.calls()).slice(before).map(c => (c.args as { cursor?: string }).cursor);
    expect(reread).toEqual([undefined, "16"]);
    expect(rows(el)).toHaveLength(20);
    expect(el.querySelector(".qdetail textarea")).toBe(box);
    expect(box.value).toBe("half-written");
    expect(el.querySelector(".qdetail .question-card-text")?.textContent).toBe("Question 18");
  } finally { model.dispose(); }
});

it("names a question's Thread that is outside the sidebar list, also during a search", async () => {
  const { model, t, db } = await fixtureModel({ route: "inbox", realPending: true, configure: db => {
    db.threads.outside = summary("outside", { title: "Archived planning thread", cwd: "/home/me/dev/old", awaiting_named_count: 1 }) as typeof db.threads[string];
    db.replies = [pendingReply("far", "outside", { kind: "name", name: "human" }, "Far question")];
    // The sidebar's page never contains this Thread.
    const answer = db.answer.bind(db);
    db.answer = c => {
      const args = (c.args ?? {}) as { thread_ids?: string[] };
      const out = answer(c);
      if (c.command === "thread.list" && !args.thread_ids && out.ok) return { ok: true, result: { items: (out.result as { items: { thread_id: string }[] }).items.filter(r => r.thread_id !== "outside") } };
      return out;
    };
  } });
  try {
    const el = draw(model);
    expect(model.data.threadList.value.items.some(r => r.thread_id === "outside")).toBe(false);
    expect(rows(el)[0]?.textContent).toContain("Archived planning thread");
    expect(rows(el)[0]?.textContent).not.toContain("outside");
    model.data.setListFilter({ query: "nothing matches" });
    await act(async () => { await settle(t, db); t.push({ t: "changed", thread_ids: [], list: true, config_changed: false }); await settle(t, db); });
    expect(rows(el)[0]?.textContent).toContain("Archived planning thread");
  } finally { model.dispose(); }
});
