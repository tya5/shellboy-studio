// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { details, flush, summary } from "../../../data/test/harness";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { ThreadManagement } from "../screens/ThreadManagement";

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
