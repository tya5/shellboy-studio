// @vitest-environment happy-dom
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { fixtureModel, fixturePendingAdapter } from "../../../ui-core/test/fixture";
import { ShellboyData } from "../../../data/src/store";
import { HumanInbox } from "../../../data/src/pending";
import { FakeTransport, connected, summary, details, flush } from "../../../data/test/harness";
import { Inbox } from "../screens/Inbox";
import type { PendingItem } from "../../../data/src/pending";
import type { OpError } from "../../../data/src";

let host: HTMLElement | undefined;
let close: (() => void) | undefined;
afterEach(() => { if (host) render(null, host); host?.remove(); close?.(); });
const question: PendingItem = { id: "synthetic-reply", threadId: "lead", threadTitle: "Synthetic", question: "Synthetic question", askedAt: undefined };
async function fixture() {
  const adapter = fixturePendingAdapter([]);
  const items = signal<PendingItem[]>([]), loading = signal(false), stale = signal(false), error = signal<OpError | undefined>(undefined);
  const pending = { ...adapter, items, loading, stale, error };
  const { model } = await fixtureModel({ route: "inbox", pending }); close = () => model.dispose();
  host = document.createElement("div"); document.body.append(host);
  const draw = () => act(() => render(<Inbox model={model} />, host!));
  const frame = async () => { await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }); return { empty: !!host!.querySelector(".empty"), question: host!.querySelector(".q .t")?.textContent, text: host!.textContent }; };
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
  const humanPage = () => transport.calls("thread.list").filter(c => (c.args as { awaiting?: string }).awaiting).at(-1)!;
  transport.ok(humanPage().id, { items: [summary("lead")], next_cursor: "synthetic-next" }); await flush();
  const duty = { message_id: "synthetic-reply", recipient_kind: "human", recipient_thread_id: "lead", excerpt: question.question, delivery_status: "accepted" };
  transport.ok(transport.calls("thread.get").at(-1)!.id, details("lead", { awaiting_replies: [duty] })); await flush();
  const { model } = await fixtureModel({ route: "inbox", pending: inbox });
  close = () => { model.dispose(); inbox.close(); list.close(); data.stop(); };
  host = document.createElement("div"); document.body.append(host); act(() => render(<Inbox model={model} />, host!));
  const before = inbox.items.peek();
  // requestFresh is driven by the real adapter's existing thread-list invalidation.
  const refresh = data.refreshThreadList(); await flush();
  const basePage = transport.calls("thread.list").filter(c => !(c.args as { awaiting?: string }).awaiting).at(-1)!;
  transport.ok(basePage.id, { items: [] }); await refresh; await flush();
  const pending = humanPage(); expect(inbox.loading.peek()).toBe(true);
  for (let frame = 0; frame < 3; frame++) {
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(host!.querySelector(".empty")).toBeNull(); expect(host!.querySelector(".q .t")?.textContent).toBe(question.question); expect(inbox.items.peek()).toBe(before);
  }
  transport.ok(pending.id, { items: [] }); await act(async () => { await flush(); });
  expect(inbox.items.peek()).toEqual([]); expect(host!.querySelector(".empty")).not.toBeNull();
});
