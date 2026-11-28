// @vitest-environment happy-dom
// #103: the open Thread's status line, recovery, Retry, header mark and menu come from that
// Thread's own facts (thread.get and its row in the row cache), not from the loaded list.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { settle, summary, type FakeOwnerDb } from "../../../data/test/harness";
import type { AppModel, DesignContext, Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
// @ts-expect-error Node file reads give happy-dom the layout rules for computed styles.
import { readFileSync } from "node:fs";

const layoutCss = readFileSync("designs/console/system/layout.css", "utf8");

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

function draw(model: AppModel) {
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
  const context: DesignContext = { model, designs: DESIGNS, prefs, setPrefs(change) { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(<App context={context} />, host!));
  return host;
}

/** The list pages never contain `broken`, as for a Thread older than the loaded pages. */
function outsideList(db: FakeOwnerDb, extra: Record<string, unknown> = {}) {
  db.threads.broken = summary("broken", { ...db.threads.broken, ...extra });
  const base = db.answer.bind(db);
  db.answer = call => {
    const args = call.args as { thread_ids?: string[] };
    if (call.command !== "thread.list" || args.thread_ids !== undefined) return base(call);
    const answer = base(call);
    if (!answer.ok) return answer;
    const result = answer.result as { items: { thread_id: string }[] };
    return { ok: true, result: { ...result, items: result.items.filter(item => item.thread_id !== "broken") } };
  };
}

const footer = (el: HTMLElement) => el.querySelector<HTMLElement>(".conversation-status")!;
const retryButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent?.trim() === "Retry");
async function headerMenu(el: HTMLElement): Promise<string[]> {
  const trigger = el.querySelector<HTMLButtonElement>("[data-conversation-header] [aria-haspopup=menu]")!;
  await act(async () => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); await Promise.resolve(); });
  const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(item => !item.disabled && item.getAttribute("aria-disabled") !== "true").map(item => item.textContent?.trim() ?? "");
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  return items;
}

describe("Open Thread facts (#103)", () => {
  it("follows keyboard-sized visual viewport changes only in a narrow conversation", async () => {
    const { model } = await fixtureModel({ route: "conversation", threadId: "lead" });
    const viewport = Object.assign(new EventTarget(), { height: 790, offsetTop: 0, scale: 1 });
    let frameWidth = 390;
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => frameWidth);
    const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    try {
      const el = draw(model);
      const frame = el.querySelector<HTMLElement>(".app")!;
      const height = () => frame.style.getPropertyValue("--conversation-viewport-height");
      expect(el.querySelector(".dock textarea")).not.toBeNull();
      expect(height()).toBe("790px");
      viewport.height = 380;
      viewport.dispatchEvent(new Event("resize"));
      expect(height()).toBe("380px");
      viewport.offsetTop = 24;
      viewport.dispatchEvent(new Event("scroll"));
      expect(height()).toBe("404px");
      viewport.scale = 2;
      viewport.dispatchEvent(new Event("resize"));
      expect(height()).toBe("");
      viewport.scale = 1;
      frameWidth = 1100;
      window.dispatchEvent(new Event("resize"));
      expect(height()).toBe("");
      frameWidth = 390;
      window.dispatchEvent(new Event("resize"));
      expect(height()).toBe("404px");
      act(() => render(null, el));
      viewport.dispatchEvent(new Event("resize"));
      expect(height()).toBe("");
    } finally {
      if (host) act(() => render(null, host!));
      if (original) Object.defineProperty(window, "visualViewport", original);
      else Reflect.deleteProperty(window, "visualViewport");
      width.mockRestore();
      model.dispose(); model.data.stop();
    }
  });

  it("announces the state once, without announcing clock ticks", async () => {
    const startedAt = "2026-11-07T10:19:00Z";
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "lead", configure(db) {
      db.threads.lead = summary("lead", { ...db.threads.lead, activity: "tools" });
      db.work.lead = [{ kind: "shell", id: "inspect", thread_id: "lead", run_id: "run-1", execution_id: "inspect", state: "running", started_at: startedAt }];
    } });
    const announcements: MutationRecord[] = [];
    const observer = new MutationObserver(records => { announcements.push(...records); });
    try {
      const el = draw(model);
      const region = el.querySelector<HTMLElement>('[data-conversation-announcement]')!;
      expect(region.textContent).toBeTruthy();
      expect(region.getAttribute("role")).toBe("status");
      expect(region.getAttribute("aria-live")).toBe("polite");
      expect(region.getAttribute("aria-atomic")).toBe("true");
      act(() => { model.now.value = Date.parse(startedAt) + 5000; });
      const previous = footer(el).textContent;
      observer.observe(region, { childList: true, characterData: true, subtree: true });
      act(() => { model.now.value += 1000; });
      act(() => { model.now.value += 1000; });
      expect(footer(el).textContent).not.toBe(previous);
      expect([...announcements, ...observer.takeRecords()]).toHaveLength(0);
      db.threads.lead = summary("lead", { ...db.threads.lead, activity: "completed" });
      await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await settle(t, db); });
      expect(region.textContent).toBe("No activity");
      expect(el.querySelector("[data-conversation-announcement]")).toBe(region);
      expect([...announcements, ...observer.takeRecords()]).toHaveLength(1);
    } finally { observer.disconnect(); model.dispose(); model.data.stop(); }
  });

  it("shows the recovery reason, one Retry, the header mark and the full menu for a Thread opened by link outside the list", async () => {
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "broken", configure: db => outsideList(db) });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      expect(model.data.listThreadIds.value).not.toContain("broken");
      expect(footer(el).textContent).toContain("Recovery wait");
      expect(el.querySelector("[data-owner-diagnostic]")?.textContent).toContain("provider: connection interrupted");
      expect(retryButtons(el)).toHaveLength(1);
      expect(footer(el).contains(retryButtons(el)[0]!)).toBe(true);
      // The charge warning is supporting text on its own row under the status line, not a hover-only title.
      const note = el.querySelector<HTMLElement>("[data-retry-note]")!;
      expect(footer(el).contains(note)).toBe(false);
      expect(footer(el).nextElementSibling).toBe(note);
      expect(note.textContent).toBe(model.t.value("recovery.body"));
      expect(retryButtons(el)[0]!.getAttribute("aria-describedby")).toBe(note.id);
      expect(retryButtons(el)[0]!.hasAttribute("title")).toBe(false);
      expect(el.querySelector(".dock [data-tone=bad], .dock .btn-warn")).toBeNull();
      expect(el.querySelector("[data-conversation-header] [data-status]")?.getAttribute("data-status")).toBe("error");
      const entries = await headerMenu(el);
      expect(entries).toEqual(expect.arrayContaining(["Rename Thread", "Archive", "Retry", "Stop", "Review deletion"]));
      await act(async () => { retryButtons(el)[0]!.click(); await settle(t, db); });
      expect(t.calls("run.retry").map(call => call.args)).toEqual([expect.objectContaining({ run_id: "run-2" })]);
    } finally { model.dispose(); }
  });

  it("wraps the full charge warning on its own row at phone width while the status line stays one line", async () => {
    (window as unknown as { happyDOM: { setWindowSize(size: { width: number; height: number }): void } }).happyDOM.setWindowSize({ width: 390, height: 844 });
    const style = document.createElement("style");
    style.id = "retry-note-styles";
    style.textContent = layoutCss;
    document.head.append(style);
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "broken" });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      const note = el.querySelector<HTMLElement>("[data-retry-note]")!;
      const warning = "Retrying sends the request again and may be charged again. Saved tool results are not run again.";
      expect(note.textContent).toBe(warning);
      const noteStyle = getComputedStyle(note);
      expect(noteStyle.whiteSpace).toBe("normal");
      expect(noteStyle.textOverflow).not.toBe("ellipsis");
      expect(noteStyle.overflow).not.toBe("hidden");
      expect(note.closest(".conversation-status")).toBeNull();
      // The status line stays one line; the evidence and hint wrap together below it.
      expect(getComputedStyle(footer(el)).whiteSpace).toBe("nowrap");
      const evidence = el.querySelector('[data-owner-diagnostic]')!.parentElement!;
      expect(getComputedStyle(evidence).whiteSpace).toBe("normal");
      expect(getComputedStyle(evidence).overflowWrap).toBe("anywhere");
      expect(evidence.textContent).toContain("Choose an action");
    } finally {
      model.dispose(); style.remove();
      (window as unknown as { happyDOM: { setWindowSize(size: { width: number; height: number }): void } }).happyDOM.setWindowSize({ width: 1024, height: 768 });
    }
  });

  it("keeps recovery and Retry in the status line while an open question makes the mark awaiting", async () => {
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "broken", configure: db => outsideList(db, { awaiting_named_count: 1 }) });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      expect(el.querySelector("[data-conversation-header] [data-status]")?.getAttribute("data-status")).toBe("awaiting");
      expect(el.querySelector("[data-owner-diagnostic]")?.textContent).toContain("provider: connection interrupted");
      expect(retryButtons(el)).toHaveLength(1);
      expect(footer(el).contains(retryButtons(el)[0]!)).toBe(true);
    } finally { model.dispose(); }
  });

  it("offers no Retry without a Run, even in recovery", async () => {
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "broken", configure: db => { outsideList(db); delete db.details.broken!.run_id; } });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      expect(el.querySelector("[data-owner-diagnostic]")?.textContent).toContain("provider: connection interrupted");
      expect(retryButtons(el)).toHaveLength(0);
      expect(el.querySelector("[data-retry-note]")).toBeNull();
    } finally { model.dispose(); }
  });

  it("re-reads the open Thread's row after an owner switch empties the row cache", async () => {
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "broken", configure: db => outsideList(db) });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      await act(async () => {
        t.push({ t: "hello", bridge_version: "0.0.1", data_dir: "/temp/owner-a", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i2", operation_epoch: "fixture.0", capabilities: ["history.window"] } } });
        await settle(t, db);
      });
      expect(model.data.threadRows.value.has("broken")).toBe(true);
      expect(footer(el).textContent).toContain("Recovery wait");
      expect(el.querySelector("[data-conversation-header] [data-status]")?.getAttribute("data-status")).toBe("error");
    } finally { model.dispose(); }
  });
});

async function rowMenu(el: HTMLElement, id: string): Promise<HTMLButtonElement[]> {
  const row = el.querySelector<HTMLAnchorElement>(`.side-list a[href="#/conversation/${id}"]`)!.closest<HTMLElement>("[data-thread-row]")!;
  await act(async () => { row.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); await Promise.resolve(); });
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}
const labels = (items: HTMLButtonElement[]) => items.map(item => item.textContent?.trim() ?? "");

describe("Row menu Stop and Retry (#107)", () => {
  it("offers Stop for a waiting Thread and for a running Thread whose question shows the awaiting mark", async () => {
    const { model, t, db } = await fixtureModel({ route: "inbox", configure: db => { db.threads.lead = summary("lead", { ...db.threads.lead, awaiting_named_count: 1 }); db.threads.done = summary("done", { ...db.threads.done, parent_thread_id: undefined }); } });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      expect(el.querySelector('.side-list a[href="#/conversation/lead"]')?.closest("[data-thread-row]")?.querySelector("[data-status]")?.getAttribute("data-status")).toBe("awaiting");
      for (const id of ["hold", "lead"]) {
        expect(labels(await rowMenu(el, id))).toContain("Stop");
        act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
      }
      expect(labels(await rowMenu(el, "done"))).not.toContain("Stop");
    } finally { model.dispose(); }
  });

  it("names the reason when Retry finds no Run", async () => {
    const { model, t, db } = await fixtureModel({ route: "inbox", configure: db => { delete db.details.broken!.run_id; } });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      const retry = (await rowMenu(el, "broken")).find(item => item.textContent?.trim() === "Retry")!;
      await act(async () => { retry.click(); await settle(t, db); });
      expect(el.textContent).toContain("Retry is not possible: this thread has no Run now.");
      expect(t.calls("run.retry")).toHaveLength(0);
    } finally { model.dispose(); }
  });
});

describe("Open Thread's own hint (#103, defect seen on main in #111)", () => {
  it("moves the sidebar, header and status line from idle to running on a Thread-only hint (list: false)", async () => {
    const { model, t, db } = await fixtureModel({ route: "conversation", threadId: "lead", configure: db => { db.threads.lead = summary("lead", { ...db.threads.lead, state: "idle", activity: "idle" }); } });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      const sidebar = () => el.querySelector('.side-list a[href="#/conversation/lead"]')?.closest("[data-thread-row]")?.querySelector("[data-status]")?.getAttribute("data-status");
      const header = () => el.querySelector("[data-conversation-header] [data-status]")?.getAttribute("data-status");
      expect([sidebar(), header()]).toEqual(["idle", "idle"]);
      expect(footer(el).querySelector('[data-status="idle"]')).not.toBeNull();
      const rowReads = t.calls("thread.list").length;
      db.threads.lead = summary("lead", { ...db.threads.lead, state: "running", activity: "tools" });
      await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await settle(t, db); });
      expect(t.calls("thread.list").slice(rowReads).map(call => call.args)).toEqual([{ thread_ids: ["lead"] }]);
      expect([sidebar(), header()]).toEqual(["running", "running"]);
      expect(footer(el).querySelector('[data-status="idle"]')).toBeNull();
      expect(footer(el).querySelector(".character-status")?.hasAttribute("data-running")).toBe(true);
    } finally { model.dispose(); }
  });
});

for (const lang of ['en', 'ja'] as const) {
  it.each(['failed', 'bridge_refusal', 'held', 'recovery_wait'] as const)(`keeps %s diagnostics stable in ${lang}`, async state => {
    const thread = state === 'recovery_wait' ? 'broken' : 'lead';
    const { model, t, db } = await fixtureModel({ lang, route: 'conversation', threadId: thread });
    try {
      const el = draw(model);
      await act(async () => { await settle(t, db); });
      let requestId: string | undefined;
      if (state !== 'recovery_wait') {
        await act(async () => {
          const send = model.send('Synthetic input');
          const call = t.calls('message.send').at(-1)!;
          db.answered.add(call.id);
          requestId = t.operationId(call.id);
          expect(requestId).toBeTruthy();
          expect(requestId).not.toBe('owner-receipt');
          if (state === 'bridge_refusal') t.push({ t: 'result', id: call.id, error: { code: 'busy', message: 'Bridge refused admission' } });
          else if (state === 'held') t.push({ t: 'result', id: call.id, response: { protocol_version: 5, operation_id: requestId!, ok: true,
            result: { thread_id: thread, message_id: 'fixture-held', assignment: 'pending', delivery_status: 'held' } } });
          else t.push({ t: 'result', id: call.id, response: { protocol_version: 5, operation_id: requestId!, ok: false,
            error: { code: 'io_failed', message: 'Saved evidence', hint: 'Choose an action' } } });
          await send;
          await settle(t, db);
        });
      }
      const diagnostic = () => el.querySelector('[data-owner-diagnostic]');
      const initial = diagnostic();
      const text = initial?.textContent;
      if (state === 'bridge_refusal') {
        expect(text).toContain('Bridge refused admission');
      } else {
        expect(text).toContain(lang === 'ja' ? 'コード:' : 'Code:');
        expect(text).toContain(state === 'held' ? 'held' : 'io_failed');
        if (state === 'held') {
          expect(text).toContain(lang === 'ja' ? '受理時は保留中でした。' : 'Held at acceptance.');
          expect(text).not.toContain(lang === 'ja' ? '次の操作:' : 'Next action:');
        } else {
          expect(text).toContain(state === 'failed' ? 'Saved evidence' : 'provider: connection interrupted');
          expect(text).toContain(`${lang === 'ja' ? '次の操作:' : 'Next action:'} Choose an action`);
        }
      }
      const receiptLabel = lang === 'ja' ? '操作ID:' : 'Operation ID:';
      if (state === 'failed' || state === 'held') expect(text).toContain(`${receiptLabel} ${requestId}`);
      else expect(text).not.toContain(receiptLabel);
      if (state === 'recovery_wait') expect(requestId).toBeUndefined();
      await act(async () => { t.push({ t: 'changed', thread_ids: [thread], list: false, config_changed: false }); await settle(t, db); });
      expect(diagnostic()).toBe(initial);
      expect(diagnostic()?.textContent).toBe(text);
      expect(t.calls('run.retry')).toHaveLength(0);
      expect(t.calls('message.send')).toHaveLength(state === 'recovery_wait' ? 0 : 1);
    } finally { model.dispose(); model.data.stop(); }
  });
}
