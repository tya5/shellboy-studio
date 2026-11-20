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
    f.t.ok(previewCall.id, { thread_id: "A", deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "a".repeat(64) } });
    await act(async () => { await flush(); });
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === f.model.t.value("thread.deleteConfirm"));
    expect(confirm).toBeDefined(); confirm!.click(); await flush();
    const deletion = f.t.calls("thread.delete").at(-1)!;
    expect(deletion.args).toEqual({ thread_id: "A", descendants: false, preview_marker: { thread_count: 1, ids_hash: "a".repeat(64) } });
    f.t.ownerError(deletion.id, "preview_stale", "stale preview");
    await act(async () => { await flush(); });
    expect(f.t.calls("thread.delete")).toHaveLength(1);
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
    f.t.ok(preview.id, { thread_id: "B", deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "b".repeat(64) } });
    await act(async () => { await flush(); });
    expect(f.t.calls("thread.delete")).toHaveLength(0);
    const retry = host.querySelector<HTMLButtonElement>("[data-thread-delete-preview]");
    expect(retry).toBeDefined();
    retry!.click(); await flush();
    const valid = f.t.calls("thread.delete_preview").at(-1)!;
    f.t.ok(valid.id, { thread_id: "A", deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "a".repeat(64) } });
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
    f.t.ok(replacement.id, { thread_id: "A", deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "c".repeat(64) } });
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
    expect(host.textContent).toContain("recovery changed at Core");
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
    expect(host.textContent).toContain("Retry refused");
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
