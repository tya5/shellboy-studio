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
