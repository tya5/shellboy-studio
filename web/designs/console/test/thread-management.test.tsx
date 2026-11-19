// @vitest-environment happy-dom
import { signal } from "@preact/signals-core";
import { act, render } from "preact/test-utils";
import { expect, it } from "vitest";
import type { ThreadDetails } from "../../../data/src";
import type { AppModel } from "../../../ui-core/src";
import { ThreadManagement } from "../screens/ThreadManagement";

const detail = (id: string): ThreadDetails => ({ thread_id: id, title: `Thread ${id}`, cwd: "/tmp", connection: "local", model: "test", shells_count: 0 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

it("does not retain A detail or late mutation state after an A-to-B route change", async () => {
  const route = signal({ view: "thread-management" as const, threadId: "A" });
  const owner = signal({ state: "connected" as const, info: { protocol_version: 5, instance_id: "owner-a", capabilities: [] } });
  const reads = new Map<string, ReturnType<typeof deferred<{ ok: true; value: ThreadDetails }>>>();
  const archive = deferred<{ ok: true; value: { archived: string[]; already: string[]; not_found: string[] } }>();
  const ops = {
    threadGet: (id: string) => {
      const next = deferred<{ ok: true; value: ThreadDetails }>();
      reads.set(id, next);
      return next.promise;
    },
    threadArchive: () => archive.promise,
    threadUnarchive: async () => ({ ok: true as const, value: {} }),
  };
  const model = { route, owner, ops, t: signal((key: string) => key) } as unknown as AppModel;
  const host = document.createElement("div");
  document.body.append(host);
  try {
    await act(async () => { render(<ThreadManagement model={model} />, host); });
    reads.get("A")!.resolve({ ok: true, value: detail("A") });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Thread A");
    (host.querySelector("button") as HTMLButtonElement).click();
    route.value = { view: "thread-management", threadId: "B" };
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).not.toContain("Thread A");
    expect(host.textContent).toContain("common.loading");
    reads.get("B")!.resolve({ ok: true, value: detail("B") });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Thread B");
    archive.resolve({ ok: true, value: { archived: ["A"], already: [], not_found: [] } });
    await act(async () => { await Promise.resolve(); });
    expect(host.textContent).toContain("Thread B");
    expect(host.textContent).not.toContain("Thread A");
  } finally {
    render(null, host);
    host.remove();
  }
});
