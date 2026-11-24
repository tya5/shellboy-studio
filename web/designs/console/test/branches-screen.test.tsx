// @vitest-environment happy-dom
// Branches (#138), mounted through the real App on the synthetic three-line family: no flicker across re-reads
// (same row elements, focus, selection, open actions and scroll; no loading row), appended messages and lanes
// that leave earlier rows in place, and the New branch and Rewind flows with the exact owner calls.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../../../data/test/harness";
import { fixtureModel } from "../../../ui-core/test/fixture";
import type { AppModel, DesignContext, Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
import { branchesFamily, type BranchesFixture } from "./fixtures/branches-family";

let host: HTMLElement | undefined;
let models: AppModel[] = [];
beforeEach(() => {
  // Happy DOM does no layout: every observed row reports itself on screen, as a tall viewport would.
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) { this.callback([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
  for (const m of models) m.dispose();
  models = [];
  vi.unstubAllGlobals();
});

const text = (el: Element | null | undefined) => el?.textContent ?? "";

async function open(options: { capabilities?: string[]; lang?: "en" | "ja"; refuseRetryTip?: boolean } = {}) {
  let family!: BranchesFixture;
  const made = await fixtureModel({ route: "branches", capabilities: options.capabilities, configure(db) {
    family = branchesFamily(db);
    if (!options.refuseRetryTip) return;
    const answer = db.answer.bind(db);
    db.answer = call => {
      const args = call.args as { thread_id?: string; expect_node_id?: string };
      return call.command === "history.window" && args.thread_id === "retry" && args.expect_node_id
        ? { ok: false, code: "invalid_input" } : answer(call);
    };
  } });
  models.push(made.model);
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: options.lang ?? "en", weights: { cached: 0.1, output: 5 } });
  if (options.lang) made.model.lang.value = options.lang;
  const context: DesignContext = { model: made.model, designs: DESIGNS, prefs, setPrefs(change) { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => { made.model.navigate({ view: "branches", threadId: "rel" }); await settle(made.t, made.db); });
  const beforeMount = made.t.calls("thread.branches").length;
  act(() => render(<App context={context} />, host!));
  const el = host;
  const flush = async () => { await act(async () => { await settle(made.t, made.db); }); await act(async () => { await settle(made.t, made.db); }); };
  await flush();
  const rows = () => [...el.querySelectorAll<HTMLLIElement>(".branch-lanes > li")];
  const row = (key: string) => el.querySelector<HTMLLIElement>(`.branch-lanes > li[data-key="${CSS.escape(key)}"]`);
  const point = (fragment: string) => [...el.querySelectorAll<HTMLButtonElement>(".lanes-point")].find((b) => text(b).includes(fragment));
  const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => text(b).includes(name));
  const refresh = async () => { await act(async () => { const reading = made.model.branches.read("rel"); await settle(made.t, made.db); await reading; }); await flush(); };
  return { ...made, el, family, flush, rows, row, point, button, refresh, beforeMount };
}

describe("Branches screen", () => {
  it("shows the header sentence, the line cards with Compare, the lanes and the comparison", async () => {
    const { el, rows } = await open();
    expect(text(el.querySelector(".page-header"))).toContain("Release notes split into 3 lines of work.");
    const cards = [...el.querySelectorAll(".branch-line")];
    expect(cards.map((c) => text(c.querySelector(".lanes-name")))).toEqual(["Release notes", "Streaming output", "Streaming + retry"]);
    expect(text(cards[1])).toContain("Split from Release notes after #6");
    expect(cards.map((c) => c.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked)).toEqual([true, true, false]);
    expect(rows().map((r) => r.dataset.key)).toEqual(["rel|start", "rel|run|1", "rel|split|r6", "rel|run|6", "rel|tip", "stream|start", "stream|run|7", "stream|split|s10", "stream|run|10", "stream|tip", "retry|start", "retry|tip"]);
    expect(text(rows()[1])).toContain("4 more messages (#2–#5)");
    expect(text(rows()[2])).toContain("Streaming output");
    expect(text(rows()[2])).toContain("splits off here");
    expect(text(rows()[4])).toContain("This Thread");
    expect(text(rows()[4])).toContain("Notes are done and linted.");
    expect(text(el.querySelector(".branch-shared"))).toContain("Both share #1–#6, up to “Compare provider behavior before writing”.");
    const sides = [...el.querySelectorAll(".branch-side")];
    expect(sides).toHaveLength(2);
    expect(text(sides[1])).toContain("#12");
    expect(text(sides[1])).toContain("Merged behind --stream.");
    expect(sides.map((s) => s.querySelector("a.branch-open")!.getAttribute("href"))).toEqual(["#/conversation/rel", "#/conversation/stream"]);
    expect(el.querySelector(".loadrows")).toBeNull();
  });

  it("marks a visible row failed on a persistent tip refusal without rereading the family", async () => {
    const { model, row, t, flush, beforeMount } = await open({ refuseRetryTip: true });
    await flush();
    const reads = t.calls("history.window").map(call => call.args as { thread_id?: string; expect_node_id?: string; node_id?: string });
    expect(reads.filter(a => a.thread_id === "retry" && a.expect_node_id)).toHaveLength(1);
    expect(reads.filter(a => a.thread_id === "retry" && a.node_id === "s10")).toHaveLength(1);
    expect(t.calls("thread.branches")).toHaveLength(beforeMount);
    expect(model.branches.failedFor({ kind: "head", threadId: "retry", start: 10, split: "s10" })).toBe(true);
    expect(row("retry|start")).not.toBeNull();
    expect(row("retry|start")!.querySelector(".lanes-pending")).toBeNull();
  });

  it("keeps the shared excerpt anchored and hides Show more at the four-page cap", async () => {
    const { el, model } = await open();
    const compare = model.branchCompare;
    const before = compare.state.peek();
    const first = before.sides[0]!;
    const anchor = first.pages[0]![0]!;
    const extra = Array.from({ length: 3 }, (_, page) => [
      { ...anchor, node_id: `page-${page}`, excerpt: `Later page ${page}`, selection: { ordinal: 3 + page } },
      ...first.pages[0]!.slice(1),
    ]);
    compare.state.value = {
      ...before,
      sides: before.sides.map((side, index) => index === 0 ? { ...side, pages: [first.pages[0]!, ...extra], next: 200 } : side),
    };
    await act(async () => { await Promise.resolve(); });
    expect(text(el.querySelector(".branch-shared"))).toContain("Compare provider behavior before writing");
    expect(text(el.querySelector(".branch-shared"))).not.toContain("Later page");
    expect([...el.querySelectorAll<HTMLButtonElement>(".branch-side button")].some(button => text(button).includes("Show more"))).toBe(false);
  });

  it("every split draws a connector from the parent's diamond to each child's column, left or right", async () => {
    const { el, row } = await open();
    const curves = (key: string) => [...row(key)!.querySelectorAll<SVGElement>(".lanes-curve")].map((c) => ({ dir: c.dataset.dir, from: Number(c.style.getPropertyValue("--from")), span: Number(c.style.getPropertyValue("--span")), d: c.querySelector("path")!.getAttribute("d") }));
    // Release notes (column 0) to Streaming output (column 1): rightwards.
    expect(curves("rel|split|r6")).toEqual([{ dir: "right", from: 0, span: 1, d: "M0 0C0 70 100 35 100 100" }]);
    // Streaming output (column 1) to Streaming + retry, which reuses column 0 once Release notes ended: leftwards.
    expect(curves("stream|split|s10")).toEqual([{ dir: "left", from: 0, span: 1, d: "M100 0C100 70 0 35 0 100" }]);
    for (const split of el.querySelectorAll<HTMLElement>(".branch-lanes > li[data-kind=split]")) {
      expect(split.querySelectorAll(".lanes-curve").length, split.dataset.key).toBeGreaterThan(0);
      for (const c of curves(split.dataset.key!)) expect(c.span, split.dataset.key).toBeGreaterThan(0);
    }
    // The child's line continues straight down from the split row to its own first row.
    const through = (key: string) => [...row(key)!.querySelectorAll<HTMLElement>(".lanes-full:not(.lanes-dashed)")].map((l) => l.style.getPropertyValue("--c"));
    expect(through("stream|run|10")).toEqual(["0"]);
    expect(through("stream|tip")).toEqual(["0"]);
    expect(row("retry|start")!.querySelector<HTMLElement>(".lanes-above")!.style.getPropertyValue("--c")).toBe("0");
  });

  it("a refresh with the same data keeps every row element, focus, the selection, its open actions and the scroll position, with no loading row", async () => {
    const { el, rows, point, refresh, t } = await open();
    await act(async () => { point("Compare provider behavior")!.click(); });
    const field = el.querySelector<HTMLInputElement>(".lanes-actions input")!;
    act(() => { field.focus(); field.value = "Make it a changelog"; field.dispatchEvent(new Event("input", { bubbles: true })); });
    const scroller = el.querySelector<HTMLElement>(".branches-main")!;
    scroller.scrollTop = 120;
    const before = rows();
    const points = [...el.querySelectorAll(".lanes-point")];
    const reads = t.calls("history.window").length;
    let loadingSeen = false;
    const watch = new MutationObserver(() => { if (el.querySelector(".loadrows, .lanes-pending, [aria-busy=true]")) loadingSeen = true; });
    watch.observe(el, { subtree: true, childList: true, attributes: true });
    await refresh();
    await refresh();
    watch.disconnect();
    expect(t.calls("thread.branches").length).toBeGreaterThanOrEqual(3);
    expect(rows()).toHaveLength(before.length);
    rows().forEach((r, i) => expect(r).toBe(before[i]));
    [...el.querySelectorAll(".lanes-point")].forEach((p, i) => expect(p).toBe(points[i]));
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("Make it a changelog");
    expect(el.querySelector(".lanes-actions input")).toBe(field);
    expect(el.querySelector<HTMLElement>(".branch-lanes > li[data-selected]")?.dataset.key).toBe("rel|split|r6");
    expect(scroller.scrollTop).toBe(120);
    expect(loadingSeen).toBe(false);
    // The open point and displayed positional heads are checked; other immutable text stays cached.
    const checks = t.calls("history.window").slice(reads).map(call => call.args as { node_id?: string });
    expect(checks.filter(args => args.node_id)).toEqual(Array.from({ length: 2 }, () => ({
      thread_id: "rel", node_id: "r6", before: 0, after: 0, excerpt_chars: 160,
    })));
  });

  it("a new message appends: earlier rows stay mounted, only the lane's last stretch and tip change", async () => {
    const { family, rows, row, refresh } = await open();
    const before = new Map(rows().map((r) => [r.dataset.key!, r]));
    const tip = row("stream|tip")!;
    family.append("stream", { node_id: "s13", kind: "user", excerpt: "Ship the flag as default." });
    await refresh();
    for (const r of rows()) if (before.has(r.dataset.key!)) expect(r).toBe(before.get(r.dataset.key!));
    expect(row("stream|tip")).toBe(tip);
    expect(text(tip)).toContain("Ship the flag as default.");
    expect(text(tip)).toContain("#13 on Streaming output");
    expect(text(row("stream|run|10"))).toContain("2 more messages (#11–#12)");
    expect(rows().map((r) => r.dataset.key)).toEqual([...before.keys()]);
  });

  it("keeps a focused row in an expanded run across an ordinary append", async () => {
    const { row, point, refresh, flush, family, el } = await open();
    await act(async () => { row("rel|run|6")!.querySelector<HTMLButtonElement>(".lanes-run")!.click(); });
    await flush();
    const before = row("rel|n|r9");
    const focused = point("Add the upgrade notes")!;
    focused.focus();
    expect(document.activeElement).toBe(focused);
    family.append("rel", { node_id: "r15", kind: "user", excerpt: "Ordinary append" });
    await refresh();
    expect(row("rel|n|r9")).toBe(before);
    expect(point("Add the upgrade notes")).toBe(focused);
    expect(document.activeElement).toBe(focused);
    expect(row("rel|run|6")).toBeNull();
    expect(text(row("rel|tip"))).toContain("Ordinary append");
    expect(el.querySelector(".loadrows")).toBeNull();
  });

  it("closes an opened message removed by a rewind and longer append in one refresh", async () => {
    const { el, row, point, refresh, flush, family, model } = await open();
    const unaffected = row("stream|tip");
    await act(async () => { row("rel|run|6")!.querySelector<HTMLButtonElement>(".lanes-run")!.click(); });
    await flush();
    await act(async () => { point("Add the upgrade notes")!.click(); });
    expect(el.querySelector(".lanes-actions")).not.toBeNull();
    family.paths.rel!.splice(7, 7, ...Array.from({ length: 8 }, (_, i) => ({ node_id: `new-${i}`, kind: "user", excerpt: `Replacement ${i}` })));
    family.revisions.rel = 20;
    await refresh();
    expect(model.branches.target.value).toBeUndefined();
    expect(el.querySelector(".lanes-actions, .branch-pinned, .loadrows")).toBeNull();
    expect(point("Add the upgrade notes")).toBeUndefined();
    expect(text(row("rel|tip"))).toContain("Replacement 7");
    expect(row("stream|tip")).toBe(unaffected);
  });

  it("re-keys actions and withdraws the rewind preview when a surviving point's path revision changes", async () => {
    const { el, row, point, button, refresh, flush, family, model, t } = await open();
    const split = row("rel|split|r6");
    await act(async () => { point("Compare provider behavior")!.click(); });
    const input = el.querySelector(".lanes-actions input");
    family.revisions.rel = 19;
    await refresh();
    expect(el.querySelector(".lanes-actions input")).not.toBe(input);
    await act(async () => { button("Rewind Release notes to here")!.click(); });
    await flush();
    expect(model.branches.rewind.value.kind).toBe("ready");
    // Core's revision is authoritative even when the family summary is byte-for-byte unchanged.
    family.revisions.rel = 20;
    await refresh();
    expect(model.branches.targetRevision.value).toBe(20);
    expect(model.branches.rewind.value.kind).toBe("idle");
    expect(t.calls("thread.rewind")).toHaveLength(1);
    expect(row("rel|split|r6")).toBe(split);
    expect(el.querySelector(".lanes-actions input")).not.toBeNull();
    expect(el.querySelector(".lanes-actions input")).not.toBe(input);
    expect(el.querySelector(".loadrows, [data-leaving]")).toBeNull();
  });

  it("keeps a surviving open row but removes its stale opened suffix after rewind and growth", async () => {
    const { el, row, point, refresh, flush, family, model } = await open();
    await act(async () => { row("rel|run|6")!.querySelector<HTMLButtonElement>(".lanes-run")!.click(); });
    await flush();
    const surviving = row("rel|n|r7");
    expect(surviving).not.toBeNull();
    expect(row("rel|n|r9")).not.toBeNull();
    await act(async () => { point("Keep the stable renderer")!.click(); });
    const input = el.querySelector(".lanes-actions input");
    expect(input).not.toBeNull();
    family.paths.rel!.splice(7, 7, ...Array.from({ length: 8 }, (_, i) => ({ node_id: `new-${i}`, kind: "user", excerpt: `Replacement ${i}` })));
    family.revisions.rel = 20;
    await refresh();
    expect(model.branches.targetRevision.value).toBe(20);
    expect(row("rel|n|r7")).toBe(surviving);
    expect(surviving!.hasAttribute("data-selected")).toBe(true);
    expect(el.querySelector(".lanes-actions input")).not.toBeNull();
    expect(el.querySelector(".lanes-actions input")).not.toBe(input);
    expect(row("rel|n|r9")).toBeNull();
    expect(point("Replacement 0")).toBeDefined();
    expect(point("Add the upgrade notes")).toBeUndefined();
    expect(model.branches.lanes.node("r9")?.excerpt).toBe("Add the upgrade notes.");
    expect(text(row("rel|tip"))).toContain("Replacement 7");
    expect(el.querySelector(".loadrows")).toBeNull();
  });

  it("discards a round when an append lands between the disclosure and point reads", async () => {
    const { el, row, point, button, flush, refresh, model, db, family, t } = await open();
    await act(async () => { row("rel|run|6")!.querySelector<HTMLButtonElement>(".lanes-run")!.click(); });
    await flush();
    await act(async () => { point("Compare provider behavior")!.click(); });
    await act(async () => { button("Rewind Release notes to here")!.click(); });
    await flush();
    const before = row("rel|n|r9");
    const focused = point("Add the upgrade notes")!;
    focused.focus();
    const originalAction = el.querySelector(".lanes-actions input");
    const answer = db.answer.bind(db);
    const start = t.calls("thread.branches").length;
    const firstWindow = t.calls("history.window").length;
    let changed = false;
    db.answer = call => {
      const args = call.args as { thread_id?: string; ordinal?: number; node_id?: string };
      if (!changed && call.command === "history.window" && args.thread_id === "rel" && args.node_id === "r6") {
        expect(t.calls("history.window").slice(firstWindow).some(x => (x.args as typeof args).ordinal === 6 && (x.args as typeof args).thread_id === "rel")).toBe(true);
        expect(row("rel|n|r9")).toBe(before);
        expect(model.branches.targetRevision.value).toBe(14);
        expect(el.querySelector(".lanes-actions input")).toBe(originalAction);
        expect(model.branches.rewind.value.kind).toBe("ready");
        family.append("rel", { node_id: "r15", kind: "user", excerpt: "Mid-round append" });
        changed = true;
      }
      return answer(call);
    };
    await refresh();
    expect(changed).toBe(true);
    expect(t.calls("thread.branches").length - start).toBe(2);
    expect(row("rel|n|r9")).toBe(before);
    expect(document.activeElement).toBe(focused);
    expect(model.branches.targetRevision.value).toBe(15);
    expect(model.branches.rewind.value.kind).toBe("idle");
    expect(el.querySelector(".lanes-actions input")).not.toBeNull();
    expect(el.querySelector(".lanes-actions input")).not.toBe(originalAction);
    expect(text(row("rel|tip"))).toContain("Mid-round append");
  });

  it("discards the old family when the tip changes at the same path length before the first window", async () => {
    const { el, row, point, flush, refresh, model, db, family, t } = await open();
    await act(async () => { row("rel|run|6")!.querySelector<HTMLButtonElement>(".lanes-run")!.click(); });
    await flush();
    await act(async () => { point("Compare provider behavior")!.click(); });
    const retained = row("rel|n|r9");
    const previous = model.branches.state.peek().family;
    const previousAction = el.querySelector(".lanes-actions input");
    const path = family.paths.rel!;
    const length = path.length;
    const oldTip = path.at(-1)!.node_id;
    const reads = t.calls("thread.branches").length;
    const windows = t.calls("history.window").length;
    const answer = db.answer.bind(db);
    let replaced = false;
    db.answer = call => {
      const args = call.args as { thread_id?: string; expect_node_id?: string };
      if (call.command === "history.window" && args.thread_id === "rel" && args.expect_node_id === oldTip && !replaced) {
        expect(t.calls("history.window").length - windows).toBe(1);
        family.revisions.rel = (family.revisions.rel ?? length) + 1;
        path.pop();
        family.append("rel", { node_id: "same-length-tip", kind: "user", excerpt: "Same-length replacement" });
        expect(path).toHaveLength(length);
        replaced = true;
      }
      if (call.command === "thread.branches" && replaced) {
        expect(model.branches.state.peek().family).toBe(previous);
        expect(row("rel|n|r9")).toBe(retained);
        expect(el.querySelector(".lanes-actions input")).toBe(previousAction);
      }
      return answer(call);
    };
    await refresh();
    expect(replaced).toBe(true);
    expect(t.calls("thread.branches").length - reads).toBe(2);
    expect(row("rel|n|r9")).toBe(retained);
    expect(text(row("rel|tip"))).toContain("Same-length replacement");
    expect(el.querySelector(".lanes-actions input")).not.toBeNull();
    expect(el.querySelector(".lanes-actions input")).not.toBe(previousAction);
  });

  it("Show opens a run with one guarded read; loading shows only on that run", async () => {
    const { el, row, point, flush, t } = await open();
    const run = row("rel|run|6")!;
    const reads = t.calls("history.window").length;
    await act(async () => { run.querySelector<HTMLButtonElement>("button.lanes-run")!.click(); });
    expect(run.querySelector("button.lanes-run")!.getAttribute("aria-busy")).toBe("true");
    expect(el.querySelectorAll("[aria-busy=true]")).toHaveLength(1);
    await flush();
    const opened = t.calls("history.window").slice(reads);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.args).toEqual({ thread_id: "rel", ordinal: 5, expect_node_id: "r6", before: 0, after: 7, excerpt_chars: 160 });
    expect(point("Kept it. 12 fixes drafted under Fixed.")).toBeDefined();
    expect(row("rel|run|6")).toBeNull();
    expect(row("rel|n|r8")).not.toBeNull();
  });

  it("New branch from here sends thread.fork for the selected row's lane and node, then the request; the new lane is appended", async () => {
    const { el, rows, point, button, flush, t } = await open();
    const before = rows();
    await act(async () => { point("Retries drop the chunks")!.click(); });
    expect(text(el.querySelector(".lanes-actions"))).toContain("A new branch keeps #1–#10");
    const field = el.querySelector<HTMLInputElement>(".lanes-actions input")!;
    act(() => { field.value = "Try a ring buffer"; field.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { button("New branch from here")!.click(); });
    await flush();
    const fork = t.calls("thread.fork");
    expect(fork).toHaveLength(1);
    expect(fork[0]!.args).toEqual({ thread_id: "stream", node_id: "s10" });
    expect(fork[0]!.operation_id).toBeTruthy();
    const send = t.calls("message.send");
    expect(send).toHaveLength(1);
    expect(send[0]!.args).toEqual({ thread_id: "fork-1", text: "Try a ring buffer" });
    expect(text(el.querySelector(".lanes-actions"))).toContain("Made the new branch New branch 1.");
    expect(el.querySelector<HTMLAnchorElement>(".lanes-actions a.nav-link")!.getAttribute("href")).toBe("#/conversation/fork-1");
    expect(t.calls("thread.rewind")).toHaveLength(0);
    // The family re-read adds the new lane; every earlier row element stays.
    const after = rows();
    expect(after.length).toBeGreaterThan(before.length);
    for (const r of before) expect(after).toContain(r);
    expect(el.querySelectorAll(".branch-line")).toHaveLength(4);
  });

  it("Rewind to here marks the rows that would leave and shows the dry-run facts; only the second press rewinds", async () => {
    const { el, row, point, button, flush, t } = await open();
    await act(async () => { point("Compare provider behavior")!.click(); });
    expect(t.calls("thread.rewind")).toHaveLength(0);
    await act(async () => { button("Rewind Release notes to here")!.click(); });
    await flush();
    const preview = t.calls("thread.rewind");
    expect(preview).toHaveLength(1);
    expect(preview[0]!.args).toEqual({ thread_id: "rel", node_id: "r6", dry_run: true });
    expect(preview[0]!.operation_id).toBeUndefined();
    const panel = text(el.querySelector(".lanes-actions"));
    expect(panel).toContain("Rewind Release notes to #6?");
    expect(panel).toContain("8 messages (4 turns) leave Release notes");
    expect(panel).toContain("./scripts/lint-notes");
    expect(panel).toContain("Files and shell effects aren't undone");
    expect([...el.querySelectorAll<HTMLElement>(".branch-lanes > li[data-leaving]")].map((r) => r.dataset.key)).toEqual(["rel|run|6", "rel|tip"]);
    expect(text(row("rel|run|6"))).toContain("Leaves Release notes if you rewind to #6");
    expect(row("stream|start")!.dataset.leaving).toBeUndefined();
    await act(async () => { button("Rewind Release notes")!.click(); });
    await flush();
    const real = t.calls("thread.rewind");
    expect(real).toHaveLength(2);
    expect(real[1]!.args).toEqual({ thread_id: "rel", node_id: "r6" });
    expect(real[1]!.operation_id).toBeTruthy();
    expect(text(el.querySelector(".lanes-actions"))).toContain("Rewound Release notes. 8 messages left it and stay in a new branch.");
    expect(el.querySelector<HTMLAnchorElement>(".lanes-actions a.nav-link")!.getAttribute("href")).toBe("#/conversation/rel-rewound");
    expect(el.querySelector(".branch-lanes > li[data-leaving]")).toBeNull();
  });

  it("Cancel withdraws the preview and choosing another message withdraws it too", async () => {
    const { el, point, button, flush, model } = await open();
    await act(async () => { point("Compare provider behavior")!.click(); });
    await act(async () => { button("Rewind Release notes to here")!.click(); });
    await flush();
    await act(async () => { button("Cancel")!.click(); });
    expect(el.querySelector(".branch-lanes > li[data-leaving]")).toBeNull();
    await act(async () => { button("Rewind Release notes to here")!.click(); });
    await flush();
    await act(async () => { point("Retries drop the chunks")!.click(); });
    expect(model.branches.rewind.value.kind).toBe("idle");
    expect(el.querySelector(".branch-lanes > li[data-leaving]")).toBeNull();
    expect(el.querySelector<HTMLElement>(".branch-lanes > li[data-selected]")?.dataset.key).toBe("stream|split|s10");
  });

  it("without history.window it reads no excerpts and shows the owner's own requests", async () => {
    const { el, row, t } = await open({ capabilities: [] });
    expect(t.calls("history.window")).toHaveLength(0);
    expect(text(row("rel|split|r6"))).toContain("Request Compare provider behavior before writing.");
    expect(text(row("rel|tip"))).toContain("Last request Lint the notes and fix the headings.");
    expect(el.querySelector("button.lanes-run")).toBeNull();
    expect(el.querySelector(".lanes-pending")).toBeNull();
  });

  it("a message chosen from a Conversation link opens its actions above the graph", async () => {
    const { el, model, flush } = await open();
    await act(async () => { model.applyRoute({ view: "branches", threadId: "rel", nodeId: "r3" }); });
    await flush();
    const pinned = el.querySelector(".branch-pinned");
    expect(text(pinned)).toContain("#3 on Release notes");
    expect(text(pinned)).toContain("Group them by area.");
    expect(text(pinned)).toContain("New branch from here");
  });

  it("the phone Compare bar opens the comparison view and Back returns to the lanes", async () => {
    const { el, button } = await open();
    const bar = el.querySelector(".branches-bar")!;
    expect(text(bar)).toContain("Release notes and Streaming output");
    await act(async () => { bar.querySelector<HTMLButtonElement>("button")!.click(); });
    expect(el.querySelector(".branches")!.getAttribute("data-phone-view")).toBe("compare");
    await act(async () => { el.querySelector<HTMLButtonElement>(".branches-back button")!.click(); });
    expect(el.querySelector(".branches")!.getAttribute("data-phone-view")).toBe("family");
    expect(button("Compare")).toBeDefined();
  });

  it("speaks Japanese", async () => {
    const { el } = await open({ lang: "ja" });
    expect(text(el)).toContain("どこで分かれた？");
    expect(text(el)).toContain("どう違う？");
    expect(text(el.querySelector(".page-header"))).toContain("Release notes は 3 本の流れに分かれています。");
  });
});
