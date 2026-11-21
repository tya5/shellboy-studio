// @vitest-environment happy-dom
import "@preact/signals";
// @ts-expect-error Node file reads are used to verify media-scoped source CSS under Vitest.
import { readFileSync } from "node:fs";
import "../system/tokens/console.css";
import "../system/components.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ThreadDeleteDialog } from "../system/components/ThreadDeleteDialog";
import { threadMenuEntries } from "../system/components/thread-menu";
import { ThreadItem } from "../system/components/ThreadItem";
import { SelectRow } from "../system/components/SelectRow";
import type { MenuEntry } from "../system/components/Menu";
import type { AppModel } from "../../../ui-core/src";
import type { ThreadSummary } from "../../../data/src";

const rowActionCss = readFileSync("designs/console/system/components.css", "utf8");
const touchVisibilityRules = rowActionCss.match(/@media \(hover: none\)\s*\{([^}]*)\}/)?.[1] ?? "";
const row = { thread_id: "t1", title: "One", cwd: "/tmp", state: "idle", activity: "idle", updated_at: "now", excerpt: "" } as ThreadSummary;
const rowMenu = { label: "Thread row menu", entries: [{ key: "archive", label: "Archive" }] as MenuEntry[] };
function menuModel() {
  return { t: { value: (key: string) => key }, actionError: { value: undefined }, ops: { threadArchive: vi.fn(async () => ({ ok: true })), threadUnarchive: vi.fn(async () => ({ ok: true })) } } as unknown as AppModel;
}
function expectVisibleMenu() {
  const popover = document.body.querySelector<HTMLElement>(".popover");
  expect(popover).not.toBeNull();
  expect(popover!.style.visibility).not.toBe("hidden");
  expect(popover!.querySelector('[role="menu"]')).not.toBeNull();
  expect(popover!.querySelector('[role="menuitem"]')?.textContent).toBe("Archive");
}
function treeRow(title: string, current = false) {
  return <ThreadItem href="#" title={title} status={undefined} statusLabel="" depth={0} current={current} pending={0} menu={rowMenu} />;
}
function selectRow(title: string, checked = false) {
  return <SelectRow title={title} href="#" status={null} depth={0} checked={checked} checkLabel="select" onToggle={() => {}} menu={rowMenu} />;
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
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    model.ops.threadDeletePreview = vi.fn(() => new Promise((resolve) => { resolvePreview = resolve; })) as never;
    model.ops.threadDelete = vi.fn(async () => { order.push("delete"); return { ok: true }; }) as never;
    const host = document.createElement("div");
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
  it("opens a visible Menu from the ThreadItem button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(treeRow("One"), host));
    const trigger = host.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    act(() => { trigger.focus(); trigger.click(); });
    await act(async () => { await Promise.resolve(); });
    expectVisibleMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(trigger);
    act(() => render(null, host)); host.remove();
  });
  it("opens a visible Menu from the SelectRow button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(selectRow("One"), host));
    await act(async () => { host.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.click(); await Promise.resolve(); });
    expectVisibleMenu();
    act(() => render(null, host)); host.remove();
  });
  it("opens the same visible Menu from row contextmenu", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(treeRow("One"), host));
    await act(async () => { host.querySelector<HTMLElement>(".tree-item")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expectVisibleMenu();
    act(() => render(null, host)); host.remove();
  });
  it("opens a SelectRow context menu and Escape returns focus to its trigger", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(<>{treeRow("One")}{selectRow("Two")}</>, host));
    const threadRow = host.querySelector<HTMLElement>(".tree-item")!;
    const listRow = host.querySelector<HTMLElement>(".srow")!;
    const link = listRow.querySelector<HTMLAnchorElement>("a")!;
    link.focus();
    await act(async () => { threadRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(document.body.querySelectorAll(".popover")).toHaveLength(1);
    act(() => { listRow.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    const focusedBeforeSecondOpen = document.activeElement;
    await act(async () => { listRow.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(document.body.querySelectorAll(".popover")).toHaveLength(1);
    expectVisibleMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(focusedBeforeSecondOpen);
    expect(document.body.querySelector(".popover")).toBeNull();
    act(() => render(null, host)); host.remove();
  });
  it("shows every touch row trigger and only one menu at a time", async () => {
    (window as unknown as { happyDOM: { setWindowSize(size: { width: number; height: number }): void } }).happyDOM.setWindowSize({ width: 390, height: 844 });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(<>{treeRow("One")}{treeRow("Two")}{selectRow("Three")}{selectRow("Four")}</>, host));
    expect(window.matchMedia("(hover: none)").matches).toBe(true);
    expect(window.matchMedia("(hover: hover)").matches).toBe(false);
    expect(touchVisibilityRules).toMatch(/\.tree-item \.tree-action,.srow \.srow-menu\{[^}]*visibility:visible/);
    expect(touchVisibilityRules).toMatch(/width:var\(--size-row-action-touch\)/);
    expect(rowActionCss).toMatch(/\.tree-item \.tree-action,.srow-menu\{[^}]*width:var\(--size-row-action\);visibility:hidden/);
    const rows = [...host.querySelectorAll<HTMLElement>(".tree-item, .srow")];
    expect(rows).toHaveLength(4);
    expect(rows.every((item) => item.querySelector(".tree-action, .srow-menu") !== null)).toBe(true);
    const triggers = [...host.querySelectorAll<HTMLButtonElement>("[aria-haspopup=menu]")];
    for (const trigger of triggers) {
      act(() => { trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
      act(() => { trigger.focus(); trigger.click(); });
      await act(async () => { await Promise.resolve(); });
      expect(document.body.querySelectorAll(".popover")).toHaveLength(1);
    }
    act(() => render(null, host)); host.remove();
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
  });
});
