// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ThreadDeleteDialog } from "../system/components/ThreadDeleteDialog";
import { threadMenuEntries } from "../system/components/thread-menu";
import type { MenuEntry } from "../system/components/Menu";
import type { AppModel } from "../../../ui-core/src";
import type { ThreadSummary } from "../../../data/src";

const row = { thread_id: "t1", title: "One", cwd: "/tmp", state: "idle", activity: "idle", updated_at: "now", excerpt: "" } as ThreadSummary;
function menuModel() {
  return { t: { value: (key: string) => key }, actionError: { value: undefined }, ops: { threadArchive: vi.fn(async () => ({ ok: true })), threadUnarchive: vi.fn(async () => ({ ok: true })) } } as unknown as AppModel;
}
describe("Thread row menu and delete", () => {
  it("offers Stop only while running and Retry only in recovery", () => {
    const model = menuModel();
    const labels = (status: "running" | "recovery" | "idle") => threadMenuEntries(model, row, status, vi.fn()).filter((entry): entry is Exclude<MenuEntry, { separator: true }> => !("separator" in entry)).filter((entry) => !entry.disabled).map((entry) => entry.label);
    expect(labels("running")).toContain("action.stop");
    expect(labels("running")).not.toContain("action.retry");
    expect(labels("recovery")).toContain("action.retry");
    expect(labels("recovery")).not.toContain("action.stop");
    expect(labels("idle")).not.toContain("action.stop");
    expect(labels("idle")).not.toContain("action.retry");
  });
  it("does not delete until preview loads and confirmation is pressed", async () => {
    const model = menuModel();
    let resolvePreview!: (result: { ok: true; value: { deletable_now: boolean; preview_marker: { thread_count: number; ids_hash: string }; selection: { thread_count: number }; blockers: { live_run_count: number; stopping_run_count: number; truncated: boolean }; preview_marker_unavailable_reason: undefined } }) => void;
    model.ops.threadDeletePreview = vi.fn(() => new Promise((resolve) => { resolvePreview = resolve; })) as never;
    model.ops.threadDelete = vi.fn(async () => { order.push("delete"); return { ok: true }; }) as never;
    const host = document.createElement("div");
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    act(() => render(<ThreadDeleteDialog model={model} target={row} onClose={onClose} />, host));
    expect(model.ops.threadDelete).not.toHaveBeenCalled();
    await act(async () => { resolvePreview({ ok: true, value: { deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "exact" }, selection: { thread_count: 1 }, blockers: { live_run_count: 0, stopping_run_count: 0, truncated: false }, preview_marker_unavailable_reason: undefined } }); });
    expect(model.ops.threadDelete).not.toHaveBeenCalled();
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "thread.deleteConfirm")!;
    act(() => confirm.click());
    expect(order).toEqual(["close", "delete"]);
    expect(model.ops.threadDelete).toHaveBeenCalledWith("t1", { thread_count: 1, ids_hash: "exact" });
    render(null, host);
  });
});
