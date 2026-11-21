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
import { ThreadItem } from "../system/components/ThreadItem";
import { SelectRow } from "../system/components/SelectRow";
import { threadMenuEntries } from "../system/components/thread-menu";
import type { MenuEntry } from "../system/components/Menu";
import type { AppModel } from "../../../ui-core/src";
import type { ThreadSummary } from "../../../data/src";

function readSystemCss(file: string): string {
  const text = readFileSync(`designs/console/system/${file}`, "utf8");
  if (file !== "components.css") return text;
  return text.replace(/@import\s+["']([^"']+)["'];/g, (_match: string, specifier: string) => readSystemCss(specifier.replace(/^\.\//, "")));
}
const rowActionCss = readSystemCss("components.css");
const touchVisibilityRules = readFileSync("designs/console/system/components/ThreadItem/style.css", "utf8") + readFileSync("designs/console/system/components/SelectRow/style.css", "utf8");
const popoverLayerRule = rowActionCss.match(/\.popover-dismiss-layer\{([^}]*)\}/)?.[1] ?? "";
const popoverPanelRule = rowActionCss.match(/\.popover-panel\{([^}]*)\}/)?.[1] ?? "";
const layoutCss = readFileSync("designs/console/system/layout.css", "utf8");
const popoverZ = Number(readFileSync("designs/console/system/tokens/console.css", "utf8").match(/--z-popover:\s*(\d+)/)?.[1]);
const pageZIndices = [...layoutCss.matchAll(/z-index:(\d+)/g)].map((match) => Number(match[1]));
function expectModalLayerStack() {
  expect(popoverLayerRule).toMatch(/position:fixed/);
  expect(popoverLayerRule).toMatch(/inset:0/);
  expect(popoverLayerRule).toMatch(/z-index:var\(--z-popover\)/);
  expect(popoverPanelRule).toMatch(/z-index:var\(--z-popover\)/);
  expect(popoverZ).toBeGreaterThan(Math.max(...pageZIndices));
  expect([...document.body.querySelectorAll<HTMLElement>(".popover-dismiss-layer, .popover-panel")].map((el) => el.classList.contains("popover-dismiss-layer") ? "layer" : "panel")).toEqual(["layer", "panel"]);
}
const row = { thread_id: "t1", title: "One", cwd: "/tmp", state: "idle", activity: "idle", updated_at: "now", excerpt: "" } as ThreadSummary;
const rowMenu = { label: "Thread row menu", entries: [{ key: "archive", label: "Archive" }] as MenuEntry[] };
function menuModel() {
  return { t: { value: (key: string) => key }, actionError: { value: undefined }, ops: { threadArchive: vi.fn(async () => ({ ok: true })), threadUnarchive: vi.fn(async () => ({ ok: true })) } } as unknown as AppModel;
}
function expectVisibleMenu() {
  const popover = document.body.querySelector<HTMLElement>(".popover-panel");
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
    const entries = threadMenuEntries(model, row, "running", vi.fn());
    expect(entries.find((entry) => entry.key === "archive")).toMatchObject({ icon: "action.archive" });
    expect(entries.find((entry) => entry.key === "stop")).toMatchObject({ icon: "action.stop" });
    expect(entries.find((entry) => entry.key === "retry")).toMatchObject({ icon: "action.retry" });
    expect(entries.find((entry) => entry.key === "delete")).toMatchObject({ icon: "action.delete" });
    const archived = { ...row, archived_at: "now" } as ThreadSummary;
    expect(threadMenuEntries(model, archived, "idle", vi.fn()).find((entry) => entry.key === "archive")).toMatchObject({ icon: "action.unarchive" });
  });
  it("does not delete until preview loads and confirmation is pressed", async () => {
    const model = menuModel();
    let resolvePreview!: (result: { ok: true; value: { deletable_now: boolean; preview_marker: { thread_count: number; ids_hash: string }; selection: { thread_count: number }; blockers: { live_run_count: number; stopping_run_count: number; truncated: boolean }; preview_marker_unavailable_reason: undefined } }) => void;
    const order: string[] = [];
    const onClose = vi.fn(() => order.push("close"));
    model.ops.threadDeletePreview = vi.fn(() => new Promise((resolve) => { resolvePreview = resolve; })) as never;
    model.ops.threadDelete = vi.fn(async () => { order.push("delete"); return { ok: true }; }) as never;
    const host = document.createElement("div");
    const invokingControl = document.createElement("button");
    document.body.append(host, invokingControl);
    act(() => render(<ThreadDeleteDialog model={model} target={{ threadId: row.thread_id }} getReturnFocusTarget={() => invokingControl} onClose={onClose} />, host));
    const dialog = host.querySelector<HTMLDialogElement>("dialog[role=alertdialog]")!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBe("thread-delete-description");
    expect(dialog.querySelector<HTMLButtonElement>(".work-sheet-head button")).toBe(document.activeElement);
    act(() => { dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); });
    act(() => { dialog.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })); });
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
    expect(model.ops.threadDelete).not.toHaveBeenCalled();
    await act(async () => { resolvePreview({ ok: true, value: { deletable_now: true, preview_marker: { thread_count: 1, ids_hash: "exact" }, selection: { thread_count: 1 }, blockers: { live_run_count: 0, stopping_run_count: 0, truncated: false }, preview_marker_unavailable_reason: undefined } }); });
    expect(model.ops.threadDelete).not.toHaveBeenCalled();
    const confirm = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "thread.deleteConfirm")!;
    act(() => confirm.click());
    expect(order).toEqual(["close", "delete"]);
    expect(model.ops.threadDelete).toHaveBeenCalledWith("t1", { thread_count: 1, ids_hash: "exact" });
    render(null, host); host.remove(); invokingControl.remove();
  });

  it("opens a visible Menu from the ThreadItem button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(treeRow("One"), host));
    const trigger = host.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    expect(document.activeElement).not.toBe(trigger);
    act(() => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
    await act(async () => { await Promise.resolve(); });
    expectVisibleMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(trigger);
    act(() => render(null, host)); host.remove();
  });
  it("uses keyboard modality for native Enter/Space activation of the row trigger", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(treeRow("One"), host));
    const trigger = host.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    trigger.focus();
    act(() => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })); });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(document.body.querySelector('[role="menuitem"]'));
    act(() => render(null, host)); host.remove();
  });
  it("opens a visible Menu from the SelectRow button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(selectRow("One"), host));
    await act(async () => { host.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); await Promise.resolve(); });
    expectVisibleMenu();
    act(() => render(null, host)); host.remove();
  });
  it("links the trigger and menu and places context menus at the pointer", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(treeRow("One"), host));
    const trigger = host.querySelector<HTMLButtonElement>("[aria-haspopup=menu]")!;
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();
    await act(async () => { host.querySelector<HTMLElement>("[data-thread-row]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 123, clientY: 234 })); await Promise.resolve(); });
    const menu = document.body.querySelector<HTMLElement>("[role=menu]")!;
    expect(menu.id).toBe(trigger.getAttribute("aria-controls"));
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(document.body.querySelector<HTMLElement>(".popover-panel")!.style.left).toBe("123px");
    expect(document.body.querySelector<HTMLElement>(".popover-panel")!.style.top).toBe("234px");
    act(() => render(null, host)); host.remove();
  });
  it("opens the same visible Menu from row contextmenu", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(treeRow("One"), host));
    await act(async () => { host.querySelector<HTMLElement>("[data-thread-row]")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expectVisibleMenu();
    act(() => render(null, host)); host.remove();
  });
  it("returns Escape focus to the link active before SelectRow contextmenu", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(selectRow("One"), host));
    const row = host.querySelector<HTMLElement>("[data-thread-row]")!;
    const link = row.querySelector<HTMLAnchorElement>("a")!;
    link.focus();
    expect(document.activeElement).toBe(link);
    await act(async () => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expectVisibleMenu();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.activeElement).toBe(link);
    expect(document.body.querySelector(".popover-panel")).toBeNull();
    act(() => render(null, host)); host.remove();
  });
  it("outside pointer and contextmenu actions dismiss without reaching another row", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    act(() => render(<>{treeRow("One")}{treeRow("Two")}</>, host));
    const triggers = [...host.querySelectorAll<HTMLButtonElement>("[aria-haspopup=menu]")];
    const secondRow = host.querySelectorAll<HTMLElement>("[data-thread-row]")[1]!;
    const secondClick = vi.fn();
    const secondContextMenu = vi.fn();
    triggers[1]!.addEventListener("click", secondClick);
    secondRow.addEventListener("contextmenu", secondContextMenu);

    await act(async () => { triggers[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); await Promise.resolve(); });
    expectVisibleMenu();
    expectModalLayerStack();
    let layer = document.body.querySelector<HTMLElement>(".popover-dismiss-layer")!;
    const clickDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => { layer.dispatchEvent(clickDown); });
    expect(clickDown.defaultPrevented).toBe(true);
    expect(document.body.querySelector(".popover-panel")).not.toBeNull();
    layer = document.body.querySelector<HTMLElement>(".popover-dismiss-layer")!;
    const outsideClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { layer.dispatchEvent(outsideClick); });
    expect(outsideClick.defaultPrevented).toBe(true);
    expect(secondClick).not.toHaveBeenCalled();
    expect(triggers[1]!.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.querySelector(".popover-dismiss-layer")).toBeNull();

    await act(async () => { triggers[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); await Promise.resolve(); });
    layer = document.body.querySelector<HTMLElement>(".popover-dismiss-layer")!;
    act(() => { layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); });
    expect(document.body.querySelector(".popover-panel")).not.toBeNull();
    layer = document.body.querySelector<HTMLElement>(".popover-dismiss-layer")!;
    const outsideMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    act(() => { layer.dispatchEvent(outsideMenu); });
    expect(outsideMenu.defaultPrevented).toBe(true);
    expect(secondContextMenu).not.toHaveBeenCalled();
    expect(document.body.querySelector(".popover-panel")).toBeNull();
    expect(triggers[1]!.getAttribute("aria-expanded")).toBe("false");
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
    expect(touchVisibilityRules).toMatch(/@media \(hover: none\)[\s\S]*?\.thread-item-root \.tree-action\{[^}]*visibility:visible/);
    expect(touchVisibilityRules).toMatch(/width:var\(--size-row-action-touch\)/);
    expect(rowActionCss).toMatch(/\[data-menu-open=true\] \.tree-action/);
    expect(rowActionCss).toMatch(/\[data-menu-open=true\] \.srow-menu/);
    const rows = [...host.querySelectorAll<HTMLElement>("[data-thread-row]")];
    expect(rows).toHaveLength(4);
    expect(rows.every((item) => item.querySelector(".tree-action, .srow-menu") !== null)).toBe(true);
    const triggers = [...host.querySelectorAll<HTMLButtonElement>("[aria-haspopup=menu]")];
    act(() => { triggers[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
    await act(async () => { await Promise.resolve(); });
    expect(document.body.querySelectorAll(".menu-popover")).toHaveLength(1);
    for (const trigger of triggers.slice(1)) {
      let layer = document.body.querySelector<HTMLElement>(".popover-dismiss-layer")!;
      act(() => { layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); });
      expect(document.body.querySelector(".popover-panel")).not.toBeNull();
      layer = document.body.querySelector<HTMLElement>(".popover-dismiss-layer")!;
      act(() => { layer.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.body.querySelectorAll(".menu-popover")).toHaveLength(0);
      act(() => { trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })); });
      await act(async () => { await Promise.resolve(); });
      expect(document.body.querySelectorAll(".menu-popover")).toHaveLength(1);
    }
    act(() => render(null, host)); host.remove();
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
  });
});
