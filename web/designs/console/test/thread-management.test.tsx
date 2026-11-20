// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { signal } from "@preact/signals-core";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { details, flush, summary } from "../../../data/test/harness";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { loadPrefs, type DesignContext } from "../../../ui-core/src";
import { App } from "../screens/App";
import { ThreadManagement } from "../screens/ThreadManagement";
import { ThreadQuickAction } from "../screens/ThreadQuickAction";

async function answer(f: Awaited<ReturnType<typeof fixtureModel>>, command: string, threadId?: string): Promise<void> {
  const call = f.t.calls(command).find((candidate) => {
    if (f.db.answered.has(candidate.id)) return false;
    if (threadId === undefined) return true;
    return (candidate.args as { thread_id?: unknown } | undefined)?.thread_id === threadId;
  });
  if (!call) throw new Error(`missing unanswered ${command}`);
  f.db.answered.add(call.id);
  const out = f.db.answer(call);
  if (out.ok) f.t.ok(call.id, out.result);
  else f.t.ownerError(call.id, out.code, out.message, out.details);
  await flush();
}

it("keeps a fresh route visit isolated from a late singleton mutation", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A"), B: summary("B") };
    db.details = { A: details("A"), B: details("B") };
  } });
  const host = document.createElement("div");
  document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); });
    await answer(f, "thread.get");
    expect(host.textContent).toContain("t-A");
    (host.querySelector("button") as HTMLButtonElement).click();
    const archive = f.t.calls("thread.archive").at(-1);
    expect(archive?.args).toEqual({ thread_ids: ["A"] });

    await act(async () => { f.model.applyRoute({ view: "thread-management", threadId: "B" }); await flush(); });
    await answer(f, "thread.get", "B");
    expect(host.textContent).toContain("t-B");
    expect(host.textContent).not.toContain("t-A");

    await act(async () => { f.model.applyRoute({ view: "thread-management", threadId: "A" }); await flush(); });
    await answer(f, "thread.get", "A");
    expect(host.textContent).toContain("t-A");
    f.t.ok(archive!.id, { archived: ["A"], already: [], not_found: [] });
    await act(async () => { await flush(); });
    expect(host.textContent).toContain("t-A");
    expect(host.textContent).not.toContain(f.model.t.value("org.archivedResult", { n: 1, already: 0 }));
    expect(host.querySelector("button")?.textContent).toBe(f.model.t.value("action.archive"));
    expect(f.t.calls("thread.get")).toHaveLength(3);
  } finally {
    render(null, host);
    host.remove();
    f.model.dispose();
    f.data.stop();
  }
});

it("saves management model and effort only after same-thread readback", async () => {
  const f = await fixtureModel({ route: "threads", capabilities: ["thread.settings"], configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { effort: "low" }) };
  } });
  const host = document.createElement("div");
  document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const fields = host.querySelectorAll<HTMLInputElement>("[data-thread-settings] input");
    expect(fields).toHaveLength(2);
    await act(async () => {
      fields[0]!.value = "next-model";
      fields[0]!.dispatchEvent(new Event("input", { bubbles: true }));
      fields[1]!.value = "high";
      fields[1]!.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });
    const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("model.save"));
    expect(save).toBeDefined();
    save!.click();
    await flush();
    const setCall = f.t.calls("thread.set").at(-1);
    expect(setCall?.args).toEqual({ thread_id: "A", model: "next-model", connection: "c", effort: "high" });
    f.t.ok(setCall!.id, details("A", { model: "next-model", effort: "high" }));
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-thread-settings]")?.textContent).not.toContain(f.model.t.value("thread.settingsSaved"));
    f.db.details.A = details("A", { model: "next-model", effort: "high" });
    await answer(f, "thread.get", "A");
    expect(host.querySelector("[data-thread-settings]")?.textContent).toContain(f.model.t.value("thread.settingsSaved"));
    const readback = host.querySelectorAll<HTMLInputElement>("[data-thread-settings] input");
    expect(readback[0]?.value).toBe("next-model");
    expect(readback[1]?.value).toBe("high");
    expect(host.querySelector<HTMLButtonElement>("[data-thread-settings] button")?.disabled).toBe(false);
  } finally {
    render(null, host);
    host.remove();
    f.model.dispose();
    f.data.stop();
  }
});

it("drops a late management settings completion after navigation", async () => {
  const f = await fixtureModel({ route: "threads", capabilities: ["thread.settings"], configure(db) {
    db.threads = { A: summary("A"), B: summary("B") };
    db.details = { A: details("A"), B: details("B") };
  } });
  const host = document.createElement("div");
  document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const modelField = host.querySelector<HTMLInputElement>("[data-thread-settings] input");
    modelField!.value = "late-model";
    await act(async () => { modelField!.dispatchEvent(new Event("input", { bubbles: true })); await flush(); });
    host.querySelector<HTMLButtonElement>("[data-thread-settings] button")!.click();
    await flush();
    const setCall = f.t.calls("thread.set").at(-1)!;
    await act(async () => { f.model.applyRoute({ view: "thread-management", threadId: "B" }); await flush(); });
    await answer(f, "thread.get", "B");
    const readsBeforeAck = f.t.calls("thread.get").length;
    f.t.ok(setCall.id, details("A", { model: "late-model" }));
    await act(async () => { await flush(); });
    expect(f.t.calls("thread.get")).toHaveLength(readsBeforeAck);
    expect(host.textContent).toContain("t-B");
    expect(host.textContent).not.toContain(f.model.t.value("thread.settingsSaved"));
  } finally {
    render(null, host);
    host.remove();
    f.model.dispose();
    f.data.stop();
  }
});

it("does not arm actions for a foreign detail or dispatch a second visit mutation", async () => {
  const f = await fixtureModel({ route: "threads", capabilities: ["thread.settings"], configure(db) {
    db.threads = { A: summary("A"), B: summary("B") };
    db.details = { A: details("A"), B: details("B") };
  } });
  const host = document.createElement("div");
  document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    const first = f.t.calls("thread.get").find((call) => !f.db.answered.has(call.id))!;
    f.db.answered.add(first.id);
    f.t.ok(first.id, details("B", { model: "foreign" }));
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-thread-management] button")).toBeNull();
    expect(host.querySelector("[data-thread-settings]")).toBeNull();

    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { await flush(); });
    await answer(f, "thread.get", "A");
    host.querySelector<HTMLButtonElement>("[data-thread-management] button")!.click();
    await act(async () => { await flush(); });
    expect(f.t.calls("thread.archive")).toHaveLength(1);
    const save = host.querySelector<HTMLButtonElement>("[data-thread-settings] button")!;
    expect(save.disabled).toBe(true);
    save.click();
    expect(f.t.calls("thread.set")).toHaveLength(0);
    f.t.ok(f.t.calls("thread.archive")[0]!.id, { archived: ["A"] });
    await act(async () => { await flush(); });
    const deferredSave = host.querySelector<HTMLButtonElement>("[data-thread-settings] button")!;
    expect(deferredSave.disabled).toBe(true);
    deferredSave.click();
    expect(f.t.calls("thread.set")).toHaveLength(0);
    await answer(f, "thread.get", "A");
    expect(host.querySelector<HTMLButtonElement>("[data-thread-management] button")?.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>("[data-thread-settings] button")?.disabled).toBe(false);
  } finally {
    render(null, host);
    host.remove();
    f.model.dispose();
    f.data.stop();
  }
});


it("shares one admission across the real sidebar and Threads surfaces", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) { db.threads = { A: summary("A"), B: summary("B") }; } });
  const baseAnswer = f.db.answer.bind(f.db);
  f.db.answer = (call) => {
    const out = baseAnswer(call);
    if (call.command === "thread.list" && out.ok) {
      const archived = (call.args as { archived?: string }).archived;
      const items = (out.result as { items: Array<{ archived_at?: string }> }).items.filter((item) => archived === "only" ? item.archived_at !== undefined : item.archived_at === undefined);
      return { ok: true, result: { ...(out.result as object), items } };
    }
    return out;
  };
  const host = document.createElement("div");
  document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) {
      const pending = f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id));
      if (!pending) break;
      await answer(f, "thread.list");
    }
    const listAction = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="B"] button')!;
    const sidebarAction = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="sidebar"][data-thread-quick-action="B"] button')!;
    expect(listAction).toBeDefined();
    expect(sidebarAction).toBeDefined();
    listAction.click();
    await flush();
    const preflight = f.t.calls("thread.get").find((call) => !f.db.answered.has(call.id) && (call.args as { thread_id?: string }).thread_id === "B")!;
    expect(preflight).toBeDefined();
    f.db.answered.add(preflight.id);
    f.t.ok(preflight.id, details("B"));
    await act(async () => { await flush(); });
    sidebarAction.click();
    expect(f.t.calls("thread.archive")).toHaveLength(1);
    expect(f.t.calls("thread.archive")[0]!.args).toEqual({ thread_ids: ["B"] });
    f.t.ok(f.t.calls("thread.archive")[0]!.id, { archived: ["B"] });
    await act(async () => { await flush(); });
    const read = f.t.calls("thread.get").find((call) => call.id !== preflight.id && !f.db.answered.has(call.id) && !f.t.cancels().includes(call.id) && (call.args as { thread_id?: string }).thread_id === "B")!;
    expect(read).toBeDefined();
    expect(host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="B"] button')?.disabled).toBe(true);
    f.db.details.B = details("B", { archived_at: "now" });
    f.db.threads.B = summary("B", { archived_at: "now" });
    f.t.ok(read.id, f.db.details.B);
    await act(async () => { await flush(); });
    for (let i = 0; i < 6; i++) {
      if (i === 2) break;
      const pending = f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id));
      if (!pending) break;
      await answer(f, "thread.list");
    }
    await act(async () => { await flush(); });
    expect(host.querySelector('[data-thread-quick-surface="list"][data-thread-quick-action="B"]')).toBeNull();
    f.model.org.setMode("only");
    await act(async () => { await flush(); });
    for (let i = 0; i < 6; i++) {
      const pending = f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id));
      if (!pending) break;
      await answer(f, "thread.list");
    }
    await act(async () => { await flush(); });
    expect(host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="B"] button')?.textContent).toBe(f.model.t.value("org.unarchive"));
    expect(host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="B"] button')?.disabled).toBe(false);
  } finally {
    render(null, host); host.remove(); f.model.dispose(); f.data.stop();
  }
});


it("requires a complete marker and carries it into singleton deletion", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) { db.threads = { A: summary("A") }; db.details = { A: details("A") }; } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const preview = host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]");
    preview!.click(); await flush();
    const previewCall = f.t.calls("thread.delete_preview").at(-1)!;
    expect(previewCall.args).toEqual({ thread_id: "A", descendants: false });
    f.t.ok(previewCall.id, { thread_id: "A", descendants: false, deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "a".repeat(64) }, selection: { thread_count: 1, descendant_thread_count: 2, surviving_descendant_thread_count: 2 }, blockers: { live_run_count: 0, stopping_run_count: 0 } });
    await act(async () => { await flush(); });
    expect(host.textContent).toContain("Surviving descendant scope: 2 Thread(s).");
    expect(f.t.calls("thread.delete")).toHaveLength(0);
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("thread.deleteConfirm"));
    expect(confirm).toBeDefined(); confirm!.click(); await flush();
    const deletion = f.t.calls("thread.delete").at(-1)!;
    expect(deletion.args).toEqual({ thread_id: "A", descendants: false, preview_marker: { thread_count: 1, ids_hash: "a".repeat(64) } });
    f.t.ownerError(deletion.id, "preview_stale", "stale preview");
    await act(async () => { await flush(); });
    expect(f.t.calls("thread.delete")).toHaveLength(1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("accepts singleton deletion then retires action after a causal list refresh", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) { db.threads = { A: summary("A"), B: summary("B") }; db.details = { A: details("A") }; } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const initialRefresh = f.model.data.refreshThreadList();
    await act(async () => { await flush(); });
    const initialLists = f.t.calls("thread.list");
    const initialList = initialLists.at(-1)!;
    expect(initialList).toBeDefined();
    f.db.answered.add(initialList.id);
    const initialOut = f.db.answer(initialList);
    expect(initialOut.ok).toBe(true);
    if (initialOut.ok) f.t.ok(initialList.id, initialOut.result);
    await initialRefresh;
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "A")).toBe(true);
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "B")).toBe(true);
    host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]")!.click(); await flush();
    const preview = f.t.calls("thread.delete_preview").at(-1)!;
    f.t.ok(preview.id, { thread_id: "A", descendants: false, deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "e".repeat(64) }, selection: { thread_count: 1, surviving_descendant_thread_count: 0 }, blockers: { live_run_count: 0, stopping_run_count: 0 } });
    await act(async () => { await flush(); });
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("thread.deleteConfirm"));
    expect(confirm).toBeDefined();
    expect(f.t.calls("thread.delete")).toHaveLength(0);
    expect(host.textContent).toContain("Surviving descendant scope: 0 Thread(s).");
    const listBeforeAck = f.t.calls("thread.list").length;
    confirm!.click(); await flush();
    const deletion = f.t.calls("thread.delete").at(-1)!;
    expect(f.t.calls("thread.delete")).toHaveLength(1);
    expect(deletion.args).toEqual({ thread_id: "A", descendants: false, preview_marker: { thread_count: 1, ids_hash: "e".repeat(64) } });
    expect(f.t.calls("thread.list").length).toBe(listBeforeAck);
    expect(host.textContent).not.toContain(f.model.t.value("thread.deleteDone"));
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "A")).toBe(true);
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "B")).toBe(true);
    f.t.ok(deletion.id, { accepted: true });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-thread-delete-preview]")).toBeNull();
    expect(host.textContent).toContain(f.model.t.value("thread.deleteDone"));
    const refreshFrontierBeforeReply = f.t.calls("thread.list").slice(listBeforeAck);
    expect(refreshFrontierBeforeReply).toHaveLength(1);
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "A")).toBe(true);
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "B")).toBe(true);
    const refreshes = f.t.calls("thread.list").slice(listBeforeAck);
    expect(refreshes).toEqual(refreshFrontierBeforeReply);
    const refresh = refreshes[0]!;
    f.db.threads = { B: summary("B") };
    f.db.answered.add(refresh.id);
    const refreshOut = f.db.answer(refresh);
    expect(refreshOut.ok).toBe(true);
    if (refreshOut.ok) f.t.ok(refresh.id, refreshOut.result);
    await act(async () => { await flush(); });
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "A")).toBe(false);
    expect(f.model.data.threadList.value.items.some((item) => item.thread_id === "B")).toBe(true);
    expect(f.t.calls("thread.delete")).toHaveLength(1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("rejects same-ID descendant scope before preview facts or confirmation", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) { db.threads = { A: summary("A") }; db.details = { A: details("A") }; } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]")!.click(); await flush();
    const preview = f.t.calls("thread.delete_preview").at(-1)!;
    f.t.ok(preview.id, { thread_id: "A", descendants: true, deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "d".repeat(64) }, selection: { surviving_descendant_thread_count: 77 }, blockers: { live_run_count: 7, stopping_run_count: 8 } });
    await act(async () => { await flush(); });
    expect(host.textContent).not.toContain("77");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === f.model.t.value("thread.deleteConfirm"))).toBe(false);
    expect(f.t.calls("thread.delete")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("shows bounded blocker counts without exposing confirm", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) { db.threads = { A: summary("A") }; db.details = { A: details("A") }; } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]")!.click(); await flush();
    const preview = f.t.calls("thread.delete_preview").at(-1)!;
    f.t.ok(preview.id, { thread_id: "A", descendants: false, deletable_now: false, preview_marker: { thread_count: 1, ids_hash: "b".repeat(64) }, selection: { thread_count: 1, descendant_thread_count: null, surviving_descendant_thread_count: null }, blockers: { live_run_count: 1, stopping_run_count: 2 }});
    await act(async () => { await flush(); });
    expect(host.textContent).toContain("Blockers observed: 1 live, 2 stopping.");
    expect(host.textContent).toContain("Surviving descendant scope: ? Thread(s).");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === f.model.t.value("thread.deleteConfirm"))).toBe(false);
    expect(f.t.calls("thread.delete")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("does not delete on foreign or stale singleton deletion proof", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) { db.threads = { A: summary("A"), B: summary("B") }; db.details = { A: details("A"), B: details("B") }; } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]")!.click(); await flush();
    const preview = f.t.calls("thread.delete_preview").at(-1)!;
    f.t.ok(preview.id, { thread_id: "B", descendants: false, deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "b".repeat(64) }, selection: { surviving_descendant_thread_count: 99 }, blockers: { live_run_count: 99, stopping_run_count: 98 } });
    await act(async () => { await flush(); });
    expect(host.textContent).not.toContain("99 live");
    expect(host.textContent).not.toContain("98 stopping");
    expect(f.t.calls("thread.delete")).toHaveLength(0);
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === f.model.t.value("thread.deleteConfirm"))).toBe(false);
    const retry = host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]");
    expect(retry).toBeDefined();
    retry!.click(); await flush();
    const valid = f.t.calls("thread.delete_preview").at(-1)!;
    f.t.ok(valid.id, { thread_id: "A", descendants: false, deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "a".repeat(64) } });
    await act(async () => { await flush(); });
    const staleConfirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("thread.deleteConfirm"));
    expect(staleConfirm).toBeDefined();
    const cancel = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("thread.deleteCancel"));
    expect(cancel).toBeDefined();
    cancel!.click();
    await act(async () => { await flush(); });
    staleConfirm!.click();
    expect(f.t.calls("thread.delete")).toHaveLength(0);
    host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]")!.click();
    await flush();
    const replacement = f.t.calls("thread.delete_preview").at(-1)!;
    expect(replacement.id).not.toBe(valid.id);
    f.t.ok(replacement.id, { thread_id: "A", descendants: false, deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "c".repeat(64) } });
    await act(async () => { await flush(); });
    const replacementConfirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("thread.deleteConfirm"));
    expect(replacementConfirm).toBeDefined();
    staleConfirm!.click();
    expect(f.t.calls("thread.delete")).toHaveLength(0);
    f.model.applyRoute({ view: "thread-management", threadId: "B" });
    await act(async () => { await flush(); });
    await answer(f, "thread.get", "B");
    expect(f.t.calls("thread.delete")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("publishes only a fully correlated current management Run/Turn observation", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const run = f.t.calls("run.get").at(-1)!;
    f.t.ok(run.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    const turn = f.t.calls("turn.get").at(-1)!;
    f.t.ok(turn.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "retry" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).toBe("ready");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("drops stale and mismatched management observations", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-old", turn_id: "turn-old" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const oldRun = f.t.calls("run.get").at(-1)!;
    f.db.details.A = details("A", { run_id: "run-new", turn_id: "turn-new" });
    await act(async () => { f.model.applyRoute({ view: "thread-management", threadId: "A" }); await flush(); });
    await answer(f, "thread.get", "A");
    const newRun = f.t.calls("run.get").at(-1)!;
    f.t.ok(oldRun.id, { run_id: "run-old", thread_id: "A", state: "live", turn_id: "turn-old" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).not.toBe("ready");
    expect(f.t.calls("turn.get")).toHaveLength(0);
    f.t.ok(newRun.id, { run_id: "run-new", thread_id: "other", state: "live", turn_id: "turn-new" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).toBe("unavailable");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("revokes ready Run/Turn observation after same-visit accepted detail replacement", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-old", turn_id: "turn-old" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const oldRun = f.t.calls("run.get").at(-1)!;
    f.t.ok(oldRun.id, { run_id: "run-old", thread_id: "A", state: "live", turn_id: "turn-old" });
    await act(async () => { await flush(); });
    const oldTurn = f.t.calls("turn.get").at(-1)!;
    f.t.ok(oldTurn.id, { turn_id: "turn-old", run_id: "run-old", thread_id: "A", state: "recovery_wait", recovery_hint: "retry" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).toBe("ready");
    (host.querySelector("[data-thread-management] button") as HTMLButtonElement).click();
    const archive = f.t.calls("thread.archive").at(-1)!;
    f.t.ok(archive.id, { archived: ["A"], already: [], not_found: [] });
    await act(async () => { await flush(); });
    f.db.details.A = details("A", { run_id: "run-new", turn_id: "turn-new" });
    const refresh = f.t.calls("thread.get").at(-1)!;
    f.db.answered.add(refresh.id);
    f.t.ok(refresh.id, f.db.details.A);
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).toBe("unavailable");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("invalidates ready Run/Turn observation after same-visit accepted detail replacement", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-old", turn_id: "turn-old" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    const oldRun = f.t.calls("run.get").at(-1)!;
    (host.querySelector("[data-thread-management] button") as HTMLButtonElement).click();
    const archive = f.t.calls("thread.archive").at(-1)!;
    f.t.ok(archive.id, { archived: ["A"], already: [], not_found: [] });
    await act(async () => { await flush(); });
    f.db.details.A = details("A", { run_id: "run-new", turn_id: "turn-new" });
    const refresh = f.t.calls("thread.get").at(-1)!;
    f.db.answered.add(refresh.id);
    f.t.ok(refresh.id, f.db.details.A);
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).toBe("unavailable");
    f.t.ok(oldRun.id, { run_id: "run-old", thread_id: "A", state: "live", turn_id: "turn-old" });
    await act(async () => { await flush(); });
    expect(f.t.calls("turn.get")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("retries only after fresh exact Thread/Run/Turn admission", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retry = f.t.calls("run.retry").at(-1)!;
    expect(retry.args).toEqual({ run_id: "run-a" });
    f.t.ownerError(retry.id, "invalid_state", "recovery changed at Core");
    await act(async () => { await flush(); });
    expect(f.t.calls("run.retry")).toHaveLength(1);
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toContain(f.model.t.value("action.retryOwnerRefused"));
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toContain("provider interrupted");
    expect(host.textContent).toContain("recovery changed at Core");
    expect(host.textContent).not.toContain(f.model.t.value("action.retryAccepted"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("refuses changed Run state without a retry write", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "completed", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    expect(f.t.calls("run.retry")).toHaveLength(0);
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toContain(f.model.t.value("action.retryRefused"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("stops only after fresh exact running preflight", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    const stop = [...host.querySelectorAll<HTMLButtonElement>("[data-run-actions] button")].find((button) => button.textContent === f.model.t.value("action.stop"));
    expect(stop).toBeDefined();
    stop!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    const stops = f.t.calls("run.stop");
    expect(stops).toHaveLength(1);
    expect(host.querySelector("[data-run-actions] .notice")).toBeNull();
    const call = stops[0]!;
    expect(call.args).toEqual({ run_id: "run-a" });
    f.t.ok(call.id, { run_id: "run-a", thread_id: "A", state: "stopping", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toBe(f.model.t.value("action.stopAccepted"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("refuses changed Run state without a Stop write", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "completed", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    expect(f.t.calls("run.stop")).toHaveLength(0);
    expect(host.textContent).toContain("Stop refused");
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("shows Retry acceptance without claiming completion", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retries = f.t.calls("run.retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]!.args).toEqual({ run_id: "run-a" });
    expect(host.querySelector("[data-run-actions] .notice")).toBeNull();
    render(null, host);
    await act(async () => { f.model.applyRoute({ view: "thread-management", threadId: "A" }); render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    expect(host.querySelectorAll("[data-run-actions] button")).toHaveLength(0);
    expect(f.t.calls("run.retry")).toHaveLength(1);
    f.t.ok(retries[0]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("keeps an unconfirmed Retry unknown without reminting its operation", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retry = f.t.calls("run.retry").at(-1)!;
    f.t.drop();
    await act(async () => { await flush(); });
    expect(f.model.managementUnconfirmedRetry.value.get("i1:A:retry")?.operationId).toBe(retry.operation_id);
    expect(f.t.calls("run.retry")).toHaveLength(1);
    f.t.open();
    f.t.push({ t: "hello", bridge_version: "0.0.1", data_dir: "/temp/owner-a", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: ["history.window"] } } });
    render(null, host);
    await act(async () => { f.model.applyRoute({ view: "threads" }); await flush(); f.model.applyRoute({ view: "thread-management", threadId: "A" }); render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toContain(retry.operation_id);
    expect(host.querySelectorAll("[data-run-actions] button")).toHaveLength(0);
    expect(f.t.calls("run.retry")).toHaveLength(1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});


it("shows Retry ACK on the same visit without claiming completion", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retries = f.t.calls("run.retry");
    expect(retries).toHaveLength(1);
    expect(host.querySelector("[data-run-actions] .notice")).toBeNull();
    f.t.ok(retries[0]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toBe(f.model.t.value("action.retryAccepted"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("holds one mounted Stop preflight across same-target management competitors", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const first = document.createElement("div"); const second = document.createElement("div"); document.body.append(first, second);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, first); render(<ThreadManagement model={f.model} />, second); await flush(); });
    await answer(f, "thread.get", "A"); await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get")[0]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    f.t.ok(f.t.calls("run.get")[1]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get")[0]!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    f.t.ok(f.t.calls("turn.get")[1]!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    (first.querySelector("[data-run-actions] button") as HTMLButtonElement).click();
    expect(f.t.calls("thread.get")).toHaveLength(3);
    const competitor = second.querySelector<HTMLButtonElement>("[data-run-actions] button");
    expect(competitor).toBeDefined();
    expect(competitor?.disabled).toBe(false);
    competitor!.click();
    expect(f.t.calls("thread.get")).toHaveLength(3);
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { render(null, first); render(null, second); first.remove(); second.remove(); f.model.dispose(); f.data.stop(); }
});

it("drops a mounted Stop preflight after invalidation without a Stop wire", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get")[0]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get")[0]!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    expect(f.t.calls("thread.get")).toHaveLength(2);
    await act(async () => { f.model.applyRoute({ view: "threads" }); await flush(); });
    await answer(f, "thread.get", "A");
    expect(f.t.calls("run.get")).toHaveLength(1);
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("retains mounted Stop exclusion through ACK then permits exact re-admission", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); const second = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get")[0]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get")[0]!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    host.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get")[1]!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get")[1]!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    document.body.append(second);
    await act(async () => { render(<ThreadManagement model={f.model} />, second); await flush(); });
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    const firstStop = f.t.calls("run.stop")[0]!;
    expect(firstStop.args).toEqual({ run_id: "run-a" });
    const threadReadsBeforePendingContender = f.t.calls("thread.get").length;
    second.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    expect(f.t.calls("thread.get")).toHaveLength(threadReadsBeforePendingContender);
    expect(f.t.calls("run.stop")).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>("[data-run-actions] button")?.disabled).toBe(true);
    f.t.ok(firstStop.id, { run_id: "run-a", thread_id: "A", state: "stopping", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-run-actions] .notice")?.textContent).toBe(f.model.t.value("action.stopAccepted"));
    const threadReadsBeforeReAdmit = f.t.calls("thread.get").length;
    second.querySelector<HTMLButtonElement>("[data-run-actions] button")!.click();
    expect(f.t.calls("thread.get")).toHaveLength(threadReadsBeforeReAdmit + 1);
    await answer(f, "thread.get", "A");
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", state: "live", turn_id: "turn-a" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    expect(f.t.calls("run.stop")).toHaveLength(2);
  } finally { render(null, host); render(null, second); host.remove(); second.remove(); f.model.dispose(); f.data.stop(); }
});

it("on-demand Stop is wired on mounted sidebar and list rows", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) {
      const pending = f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id));
      if (!pending) break;
      await answer(f, "thread.list");
    }
    const listStop = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="A"] [data-thread-quick-stop]')!;
    const sidebarStop = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="sidebar"][data-thread-quick-action="A"] [data-thread-quick-stop]')!;
    expect(listStop).toBeDefined();
    expect(sidebarStop).toBeDefined();
    expect(f.t.calls("thread.get")).toHaveLength(0);
    listStop.click();
    const preflight = f.t.calls("thread.get").at(-1)!;
    expect(preflight.args).toEqual({ thread_id: "A" });
    sidebarStop.click();
    expect(f.t.calls("thread.get")).toHaveLength(1);
    f.t.ok(preflight.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    const stop = f.t.calls("run.stop").at(-1)!;
    expect(stop.args).toEqual({ run_id: "run-a" });
    f.t.ok(stop.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "stopping" });
    await act(async () => { await flush(); });
    expect(host.querySelector('[data-thread-quick-surface="list"][data-thread-quick-action="A"]')?.textContent).toContain(f.model.t.value("action.stopAccepted"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("drops a quick Stop after row unmount without a Stop wire", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="A"] [data-thread-quick-stop]')!.click();
    const preflight = f.t.calls("thread.get").at(-1)!;
    render(null, host);
    f.t.ok(preflight.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await flush();
    expect(f.t.calls("run.get")).toHaveLength(0);
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("refuses an ineligible quick Stop after exact reads", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="A"] [data-thread-quick-stop]')!.click();
    const preflight = f.t.calls("thread.get").at(-1)!;
    f.t.ok(preflight.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    expect(f.t.calls("run.stop")).toHaveLength(0);
    expect(host.textContent).toContain(f.model.t.value("action.stopRefused"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("retains lost quick Stop identity across same-owner reconnect on both surfaces", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="A"] [data-thread-quick-stop]')!.click();
    const preflight = f.t.calls("thread.get").at(-1)!;
    f.t.ok(preflight.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    const stop = f.t.calls("run.stop").at(-1)!;
    f.t.drop();
    await act(async () => { await flush(); });
    expect(f.model.managementUnconfirmedRetry.value.get("i1:A:stop")?.operationId).toBe(stop.operation_id);
    f.t.open();
    f.t.push({ t: "hello", bridge_version: "0.0.1", data_dir: "/temp/owner-a", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: ["history.window"] } } });
    render(null, host);
    await act(async () => { f.model.applyRoute({ view: "threads" }); render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    const listRow = host.querySelector('[data-thread-quick-surface="list"][data-thread-quick-action="A"]');
    const sidebarRow = host.querySelector('[data-thread-quick-surface="sidebar"][data-thread-quick-action="A"]');
    expect(listRow).not.toBeNull();
    expect(sidebarRow).not.toBeNull();
    expect(listRow?.querySelector("[data-thread-quick-stop]")).toBeNull();
    expect(sidebarRow?.querySelector("[data-thread-quick-stop]")).toBeNull();
    expect(listRow?.textContent).toContain(stop.operation_id);
    expect(sidebarRow?.textContent).toContain(stop.operation_id);
    const threadBeforeManagement = f.t.calls("thread.get").length;
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { await flush(); });
    const newThreads = f.t.calls("thread.get").slice(threadBeforeManagement);
    expect(newThreads).toHaveLength(1);
    const managementThread = newThreads[0]!;
    expect((managementThread.args as { thread_id?: string }).thread_id).toBe("A");
    const runBeforeThreadReply = f.t.calls("run.get").length;
    f.db.answered.add(managementThread.id);
    f.t.ok(managementThread.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    const newRuns = f.t.calls("run.get").slice(runBeforeThreadReply);
    expect(newRuns).toHaveLength(1);
    const managementRun = newRuns[0]!;
    expect((managementRun.args as { run_id?: string; thread_id?: string }).run_id).toBe("run-a");
    const turnBeforeRunReply = f.t.calls("turn.get").length;
    f.db.answered.add(managementRun.id);
    f.t.ok(managementRun.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    const newTurns = f.t.calls("turn.get").slice(turnBeforeRunReply);
    expect(newTurns).toHaveLength(1);
    const managementTurn = newTurns[0]!;
    expect((managementTurn.args as { turn_id?: string; run_id?: string }).turn_id).toBe("turn-a");
    f.db.answered.add(managementTurn.id);
    f.t.ok(managementTurn.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" });
    await act(async () => { await flush(); });
    expect(host.querySelector("[data-management-observation]")?.getAttribute("data-management-observation")).toBe("ready");
    const managementActions = host.querySelector("[data-run-actions]");
    expect(managementActions).not.toBeNull();
    expect(managementActions?.textContent).toContain(stop.operation_id);
    expect(managementActions?.textContent).toContain(f.model.t.value("action.stopUnknown"));
    expect(managementActions?.querySelectorAll("button")).toHaveLength(0);
    expect(f.t.calls("run.stop")).toHaveLength(1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("qualifies quick Stop from a clicked row and rejects a valid mismatched identity", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }), B: details("B", { run_id: "run-b", turn_id: "turn-b" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    expect(f.t.calls("thread.get")).toHaveLength(0);
    host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="A"] [data-thread-quick-stop]')!.click();
    const preflight = f.t.calls("thread.get").at(-1)!;
    expect(preflight.args).toEqual({ thread_id: "A" });
    f.db.answered.add(preflight.id);
    f.t.ok(preflight.id, details("B", { run_id: "run-b", turn_id: "turn-b" }));
    await act(async () => { await flush(); });
    expect(f.t.calls("run.get")).toHaveLength(0);
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("drops quick Stop after mounted row invalidation without follow-on reads or wire", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["A"]);
    await act(async () => { render(<App context={context} />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="list"][data-thread-quick-action="A"] [data-thread-quick-stop]')!.click();
    const preflight = f.t.calls("thread.get").at(-1)!;
    await act(async () => { f.model.applyRoute({ view: "threads" }); render(null, host); await flush(); });
    f.db.answered.add(preflight.id);
    f.t.ok(preflight.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    expect(f.t.calls("run.get")).toHaveLength(0);
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("keeps an opted-in mounted Retry row route-fenced before exact re-admission", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    const row = summary("A");
    await act(async () => { render(<ThreadQuickAction model={f.model} row={row} surface="list" enableRetry />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    expect(f.t.calls("thread.get")).toHaveLength(0);
    host.querySelector<HTMLButtonElement>("[data-thread-quick-retry]")!.click();
    const firstRead = f.t.calls("thread.get").at(-1)!;
    expect(firstRead.args).toEqual({ thread_id: "A" });
    const firstReservation = f.model.managementRetryReservations.value.get("i1:A:retry");
    expect(firstReservation?.threadId).toBe("A");
    expect(firstReservation?.operationId).toBeTruthy();
    const firstOperationId = firstReservation!.operationId;
    await act(async () => { f.model.applyRoute({ view: "threads", threadId: "A" }); await flush(); });
    f.t.ok(firstRead.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    expect(f.t.calls("run.get")).toHaveLength(0);
    expect(f.t.calls("turn.get")).toHaveLength(0);
    expect(f.t.calls("run.retry")).toHaveLength(0);
    expect(f.model.managementRetryReservations.value.has("i1:A:retry")).toBe(false);
    expect(firstOperationId).not.toBe("");

    await act(async () => { f.model.applyRoute({ view: "threads" }); await flush(); });
    host.querySelector<HTMLButtonElement>("[data-thread-quick-retry]")!.click();
    const secondRead = f.t.calls("thread.get").at(-1)!;
    expect(secondRead.id).not.toBe(firstRead.id);
    const secondReservation = f.model.managementRetryReservations.value.get("i1:A:retry");
    expect(secondReservation?.threadId).toBe("A");
    expect(secondReservation?.operationId).toBeTruthy();
    expect(secondReservation?.operationId).not.toBe(firstOperationId);
    const secondOperationId = secondReservation!.operationId;
    f.t.ok(secondRead.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    const freshRun = f.t.calls("run.get").at(-1)!;
    expect(freshRun.args).toEqual({ run_id: "run-a" });
    f.t.ok(freshRun.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    const freshTurn = f.t.calls("turn.get").at(-1)!;
    expect(freshTurn.args).toEqual({ turn_id: "turn-a" });
    f.t.ok(freshTurn.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retry = f.t.calls("run.retry");
    expect(retry).toHaveLength(1);
    expect(retry[0]!.args).toEqual({ run_id: "run-a" });
    expect(retry[0]!.operation_id).toBe(secondOperationId);
    expect(f.model.managementRetryReservations.value.get("i1:A:retry")?.operationId).toBe(secondOperationId);
    f.t.ok(retry[0]!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    expect(f.model.managementRetryReservations.value.has("i1:A:retry")).toBe(false);
    expect(host.querySelector<HTMLButtonElement>("[data-thread-quick-retry]")?.disabled).toBe(false);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("rejects a mounted Retry identity mismatch before downstream reads or wire", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A"), B: summary("B") };
    db.details = {
      A: details("A", { run_id: "run-a", turn_id: "turn-a" }),
      B: details("B", { run_id: "run-b", turn_id: "turn-b" }),
    };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    const row = summary("A");
    await act(async () => { render(<ThreadQuickAction model={f.model} row={row} surface="list" enableRetry />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    expect(f.t.calls("thread.get")).toHaveLength(0);
    const control = host.querySelector<HTMLButtonElement>("[data-thread-quick-retry]")!;
    control.click();
    const threadRead = f.t.calls("thread.get").at(-1)!;
    expect(threadRead.args).toEqual({ thread_id: "A" });
    const reservation = f.model.managementRetryReservations.value.get("i1:A:retry");
    expect(reservation?.threadId).toBe("A");
    expect(reservation?.operationId).toBeTruthy();
    f.t.ok(threadRead.id, details("B", { run_id: "run-b", turn_id: "turn-b" }));
    await act(async () => { await flush(); });
    expect(f.t.calls("run.get")).toHaveLength(0);
    expect(f.t.calls("turn.get")).toHaveLength(0);
    expect(f.t.calls("run.retry")).toHaveLength(0);
    expect(f.model.managementRetryReservations.value.has("i1:A:retry")).toBe(false);
    expect(control.disabled).toBe(false);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("qualifies the real opted-in App sidebar Retry row for a selected sibling", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A"), B: summary("B") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["B"]);
    await act(async () => { render(<App context={context} enableRetryRows />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    expect(f.t.calls("thread.get")).toHaveLength(0);
    const control = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="sidebar"][data-thread-quick-action="A"] [data-thread-quick-retry]')!;
    control.click();
    const threadRead = f.t.calls("thread.get").at(-1)!;
    expect(threadRead.args).toEqual({ thread_id: "A" });
    const reservation = f.model.managementRetryReservations.value.get("i1:A:retry");
    expect(reservation?.threadId).toBe("A");
    expect(reservation?.operationId).toBeTruthy();
    f.t.ok(threadRead.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    const run = f.t.calls("run.get").at(-1)!;
    expect(run.args).toEqual({ run_id: "run-a" });
    f.t.ok(run.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    const turn = f.t.calls("turn.get").at(-1)!;
    expect(turn.args).toEqual({ turn_id: "turn-a" });
    f.t.ok(turn.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retry = f.t.calls("run.retry");
    expect(retry).toHaveLength(1);
    expect(retry[0]!.args).toEqual({ run_id: "run-a" });
    expect(retry[0]!.operation_id).toBe(reservation!.operationId);
    expect(f.model.managementRetryReservations.value.get("i1:A:retry")?.operationId).toBe(reservation!.operationId);
    f.t.ok(retry[0]!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    expect(f.model.managementRetryReservations.value.has("i1:A:retry")).toBe(false);
    expect(control.disabled).toBe(false);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("holds one opted-in sidebar Retry authority across a competing Stop action", async () => {
  const f = await fixtureModel({ route: "threads", configure(db) {
    db.threads = { A: summary("A"), B: summary("B") };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    f.model.org.selected.value = new Set(["B"]);
    await act(async () => { render(<App context={context} enableRetryRows />, host); await flush(); });
    for (let i = 0; i < 4; i++) { if (!f.t.calls("thread.list").find((call) => !f.db.answered.has(call.id))) break; await answer(f, "thread.list"); }
    expect(f.t.calls("thread.get")).toHaveLength(0);
    const retryControl = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="sidebar"][data-thread-quick-action="A"] [data-thread-quick-retry]')!;
    const stopControl = host.querySelector<HTMLButtonElement>('[data-thread-quick-surface="sidebar"][data-thread-quick-action="A"] [data-thread-quick-stop]')!;
    retryControl.click();
    const threadRead = f.t.calls("thread.get").at(-1)!;
    const reservation = f.model.managementRetryReservations.value.get("i1:A:retry");
    expect(reservation?.operationId).toBeTruthy();
    const threadReadsHeld = f.t.calls("thread.get").length;
    stopControl.click();
    expect(f.t.calls("thread.get")).toHaveLength(threadReadsHeld);
    expect(f.t.calls("run.stop")).toHaveLength(0);
    f.t.ok(threadRead.id, details("A", { run_id: "run-a", turn_id: "turn-a" }));
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("run.get").at(-1)!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    f.t.ok(f.t.calls("turn.get").at(-1)!.id, { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "recovery_wait", recovery_hint: "provider interrupted" });
    await act(async () => { await flush(); });
    const retry = f.t.calls("run.retry");
    expect(retry).toHaveLength(1);
    expect(retry[0]!.operation_id).toBe(reservation!.operationId);
    expect(f.model.managementRetryReservations.value.get("i1:A:retry")?.operationId).toBe(reservation!.operationId);
    expect(retryControl.disabled).toBe(true);
    const readsBeforeAckCompetitor = f.t.calls("thread.get").length;
    stopControl.click();
    expect(f.t.calls("thread.get")).toHaveLength(readsBeforeAckCompetitor);
    expect(f.t.calls("run.stop")).toHaveLength(0);
    f.t.ok(retry[0]!.id, { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" });
    await act(async () => { await flush(); });
    expect(f.model.managementRetryReservations.value.has("i1:A:retry")).toBe(false);
    expect(retryControl.disabled).toBe(false);
    stopControl.click();
    expect(f.t.calls("thread.get")).toHaveLength(readsBeforeAckCompetitor + 1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});
