// @vitest-environment happy-dom
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { fixtureModel, fixturePendingAdapter } from "../../../ui-core/test/fixture";
import { ShellboyData } from "../../../data/src/store";
import { HumanInbox } from "../../../data/src/human-inbox";
import { FakeTransport, connected, summary, details, flush } from "../../../data/test/harness";
import { Inbox } from "../screens/Inbox";
import type { PendingItem } from "../../../data/src/human-inbox";
import type { OpError } from "../../../data/src";

let host: HTMLElement | undefined;
let close: (() => void) | undefined;
afterEach(() => { if (host) render(null, host); host?.remove(); close?.(); });
const question: PendingItem = { id: "synthetic-reply", threadId: "lead", question: "Synthetic question", askedAt: undefined };
async function fixture() {
  const adapter = fixturePendingAdapter([]);
  const items = signal<PendingItem[]>([]), loading = signal(false), stale = signal(false), error = signal<OpError | undefined>(undefined);
  const pending = { ...adapter, items, loading, stale, error };
  const { model } = await fixtureModel({ route: "inbox", pending }); close = () => model.dispose();
  host = document.createElement("div"); document.body.append(host);
  const draw = () => act(() => render(<Inbox model={model} />, host!));
  const frame = async () => { await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }); return { empty: !!host!.querySelector(".empty-state-root"), question: host!.querySelector(".q .question-card-text")?.textContent, text: host!.textContent }; };
  return { items, loading, stale, error, draw, frame };
}
for (const state of ["loading", "stale"] as const) it(`does not paint confirmed empty while ${state} before the first question`, async () => {
  const f = await fixture(); act(() => { f[state].value = true; }); f.draw();
  const first = await f.frame(); expect(first.empty).toBe(false);
  act(() => { f.items.value = [question]; }); expect((await f.frame()).question).toBe(question.question);
  act(() => { f[state].value = false; }); expect((await f.frame()).question).toBe(question.question);
});
it("does not paint empty between separate refresh invalidation and replacement frames", async () => {
  const f = await fixture(); act(() => { f.items.value = [question]; }); f.draw();
  expect((await f.frame()).question).toBe(question.question);
  act(() => { f.stale.value = true; f.items.value = []; }); expect((await f.frame()).empty).toBe(false);
  act(() => { f.loading.value = true; }); expect((await f.frame()).empty).toBe(false);
  act(() => { f.items.value = [question]; }); expect((await f.frame()).question).toBe(question.question);
  act(() => { f.stale.value = false; f.loading.value = false; }); expect((await f.frame()).question).toBe(question.question);
});
it("paints confirmed empty only after empty loading finishes, and keeps error distinct", async () => {
  const f = await fixture(); act(() => { f.loading.value = true; }); f.draw();
  expect((await f.frame()).empty).toBe(false);
  act(() => { f.loading.value = false; }); expect((await f.frame()).empty).toBe(true);
  act(() => { f.error.value = { kind: "owner", code: "synthetic_error", message: "Synthetic error" }; });
  const failed = await f.frame(); expect(failed.empty).toBe(false); expect(failed.text).toContain("Synthetic error");
});
it("retains a displayed question during loading/stale", async () => {
  const f = await fixture(); act(() => { f.items.value = [question]; f.loading.value = true; f.stale.value = true; }); f.draw();
  expect((await f.frame()).question).toBe(question.question);
});

it("clears old question content on adapter scope replacement and recovers from error without empty flash", async () => {
  const f = await fixture(); act(() => { f.items.value = [question]; }); f.draw();
  expect((await f.frame()).question).toBe(question.question);
  act(() => { f.items.value = []; f.stale.value = true; f.error.value = { kind: "owner", code: "synthetic_error", message: "Synthetic retry" }; });
  const failed = await f.frame(); expect(failed.empty).toBe(false); expect(failed.question).toBeUndefined();
  act(() => { f.error.value = undefined; f.loading.value = true; }); expect((await f.frame()).empty).toBe(false);
  act(() => { f.items.value = [{ ...question, id: "replacement", threadId: "other", question: "Other synthetic question" }]; f.stale.value = false; f.loading.value = false; });
  const fresh = await f.frame(); expect(fresh.question).toBe("Other synthetic question"); expect(fresh.text).not.toContain(question.question);
});

it("holds the successful page across several RAFs while a real synthetic transport refresh is unanswered", async () => {
  const transport = new FakeTransport(); let sequence = 0;
  const data = new ShellboyData({ transport, newId: () => `synthetic-${++sequence}` });
  const inbox = new HumanInbox(data), list = data.trackThreadList(); data.start(); transport.open();
  transport.push({ t: "hello", bridge_version: "synthetic", data_dir: "/synthetic", owner: connected }); await flush();
  transport.ok(transport.calls("thread.list").find(c => !(c.args as { awaiting?: string }).awaiting)!.id, { items: [] }); await flush();
  const humanPage = () => transport.calls("message.list").at(-1)!;
  const duty = { message_id: "synthetic-reply", asked_by: "lead", sender: {kind:"model",thread_id:"lead"},
    recipient: {kind:"name",name:"human"}, excerpt: question.question, created_at: "2026-01-01T00:00:00Z" };
  transport.ok(humanPage().id, { items: [duty], next_cursor: "synthetic-next" }); await flush();
  const { model } = await fixtureModel({ route: "inbox", pending: inbox });
  close = () => { model.dispose(); inbox.close(); list.close(); data.stop(); };
  host = document.createElement("div"); document.body.append(host); act(() => render(<Inbox model={model} />, host!));
  const before = inbox.items.peek();
  transport.push({ t: "changed", thread_ids: [], list: true, config_changed: false }); await flush();
  const pending = humanPage(); expect(inbox.loading.peek()).toBe(true);
  for (let frame = 0; frame < 3; frame++) {
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(host!.querySelector(".empty-state-root")).toBeNull(); expect(host!.querySelector(".q .question-card-text")?.textContent).toBe(question.question); expect(inbox.items.peek()).toBe(before);
  }
  transport.ok(pending.id, { items: [] }); await act(async () => { await flush(); });
  expect(inbox.items.peek()).toEqual([]); expect(host!.querySelector(".empty-state-root")).not.toBeNull();
});

it("cancels the selected human question and waits for the owner hint to remove it", async () => {
  const transport = new FakeTransport(); let sequence = 0;
  const data = new ShellboyData({ transport, newId: () => `cancel-${++sequence}` });
  const inbox = new HumanInbox(data);
  close = () => { inbox.close(); data.stop(); };
  data.start(); transport.open();
  transport.push({ t: "hello", bridge_version: "synthetic", data_dir: "/synthetic", owner: connected });
  await flush();
  const page = () => transport.calls("message.list").at(-1)!;
  const duty = (id: string, excerpt: string) => ({ message_id: id, asked_by: "lead", sender: {kind: "model", thread_id: "lead"},
    recipient: {kind: "name", name: "human"}, excerpt, created_at: "2026-01-01T00:00:00Z" });
  const first = duty("first", "First question"), second = duty("second", "Second question");
  transport.ok(page().id, { items: [first, second] }); await flush();
  const { model } = await fixtureModel({ route: "inbox", pending: inbox });
  close = () => { model.dispose(); inbox.close(); data.stop(); };
  host = document.createElement("div"); document.body.append(host);
  act(() => render(<Inbox model={model} />, host!));
  const row = (text: string) => [...host!.querySelectorAll<HTMLButtonElement>(".qitem")].find(button => button.textContent?.includes(text));
  const detailButton = (key: "work.cancel" | "inbox.answerResume") => [...host!.querySelectorAll<HTMLButtonElement>(".qdetail button")].find(button => button.textContent === model.t.value(key))!;
  const alert = () => host!.querySelector(".qdetail [role=alert]");
  act(() => {
    row(second.excerpt)!.click();
  });
  act(() => {
    const box = host!.querySelector("textarea")!;
    box.value = "Draft";
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(detailButton("inbox.answerResume").disabled).toBe(false);
  await act(async () => { detailButton("work.cancel").click(); await flush(); });
  expect(detailButton("work.cancel").disabled).toBe(true);
  expect(detailButton("inbox.answerResume").disabled).toBe(true);
  const refused = transport.calls("message.cancel")[0]!;
  expect(refused.args).toEqual({ message_ids: ["second"] });
  await act(async () => { transport.ok(refused.id, { items: [{ message_id: "second", outcome: "forbidden" }] }); await flush(); });
  expect(alert()?.textContent).toBe(model.t.value("work.cancelFailed", { message: "forbidden" }));
  act(() => row(first.excerpt)!.click());
  expect(alert()).toBeNull();
  act(() => row(second.excerpt)!.click());
  expect(alert()?.textContent).toContain("forbidden");
  await act(async () => { detailButton("work.cancel").click(); await flush(); });
  expect(transport.calls("message.cancel")).toHaveLength(2);
  const retry = transport.calls("message.cancel")[1]!;
  expect(retry.args).toEqual(refused.args);
  expect(retry.operation_id).not.toBe(refused.operation_id);
  await act(async () => { transport.ok(retry.id, { items: [{ message_id: "second", outcome: "cancelled", archive_draft_id: "archive-second" }] }); await flush(); });
  expect(alert()).toBeNull();
  expect(row(second.excerpt)).toBeDefined();
  expect(transport.calls("message.list")).toHaveLength(1);
  await act(async () => { transport.push({ t: "changed", thread_ids: ["lead"], list: true, config_changed: false }); await flush(); });
  expect(row(second.excerpt)).toBeDefined();
  await act(async () => { transport.ok(page().id, { items: [first] }); await flush(); });
  expect(row(second.excerpt)).toBeUndefined();
  expect(row(first.excerpt)).toBeDefined();
  expect(alert()).toBeNull();
});
