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


it("renders management actions from projected running recovery and archived state", async () => {
  const f = await fixtureModel({ route: "thread-management", configure(db) {
    db.threads = { A: summary("A", { activity: "tools" }), B: summary("B", { activity: "recovery" }), C: summary("C", { activity: "idle", archived_at: "now" }) };
    db.details = { A: details("A", { run_id: "run-a", turn_id: "turn-a" }), B: details("B"), C: details("C", { archived_at: "now" }) };
  } });
  const host = document.createElement("div"); document.body.append(host);
  try {
    f.model.applyRoute({ view: "thread-management", threadId: "A" });
    await act(async () => { render(<ThreadManagement model={f.model} />, host); await flush(); });
    await answer(f, "thread.get", "A");
    expect([...host.querySelectorAll<HTMLButtonElement>("[data-run-actions] button")].map((button) => button.textContent)).toEqual([f.model.t.value("action.stop")]);
    f.model.applyRoute({ view: "thread-management", threadId: "B" });
    await act(async () => { await flush(); });
    await answer(f, "thread.get", "B");
    expect([...host.querySelectorAll<HTMLButtonElement>("[data-run-actions] button")].map((button) => button.textContent)).toEqual([f.model.t.value("action.retry")]);
    f.model.applyRoute({ view: "thread-management", threadId: "C" });
    await act(async () => { await flush(); });
    await answer(f, "thread.get", "C");
    expect([...host.querySelectorAll<HTMLButtonElement>("[data-run-actions] button")]).toHaveLength(0);
    expect(host.querySelector("[data-thread-management] button")?.textContent).toBe(f.model.t.value("org.unarchive"));
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("shows only state-appropriate quick row actions", () => {
  const f = fixtureModel({ route: "threads" });
  const host = document.createElement("div"); document.body.append(host);
  try {
    render(<>
      <ThreadQuickAction model={f.model} row={summary("run")} status="running" surface="list" />
      <ThreadQuickAction model={f.model} row={summary("retry")} status="recovery" surface="list" />
      <ThreadQuickAction model={f.model} row={summary("archived", { archived_at: "now" })} status="completed" surface="list" />
    </>, host);
    expect([...host.querySelectorAll('[data-thread-quick-action="run"] [data-thread-quick-stop]')]).toHaveLength(1);
    expect(host.querySelector('[data-thread-quick-action="run"] [data-thread-quick-retry]')).toBeNull();
    expect([...host.querySelectorAll('[data-thread-quick-action="retry"] [data-thread-quick-retry]')]).toHaveLength(1);
    expect(host.querySelector('[data-thread-quick-action="retry"] [data-thread-quick-stop]')).toBeNull();
    expect(host.querySelector('[data-thread-quick-action="archived"]')?.textContent).toContain(f.model.t.value("org.unarchive"));
    expect(host.querySelector('[data-thread-quick-action="archived"] [data-thread-quick-stop]')).toBeNull();
    expect(host.querySelector('[data-thread-quick-action="archived"] [data-thread-quick-retry]')).toBeNull();
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});
