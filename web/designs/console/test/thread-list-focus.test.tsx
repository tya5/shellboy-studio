// @vitest-environment happy-dom
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { fixtureModel, settle } from "../../../ui-core/test/fixture";
import { loadPrefs } from "../../../ui-core/src/prefs";
import type { ThreadDeletePreview } from "../../../data/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";

type Screen = "sidebar" | "threads";
type Rig = Awaited<ReturnType<typeof fixtureModel>> & { host: HTMLElement; list: HTMLElement; screen: Screen };
type PreviewResult = { ok: true; value: ThreadDeletePreview };

function preview(threadCount: number, idsHash: string): PreviewResult {
  return { ok: true, value: {
    deletable_now: true,
    preview_marker: { thread_count: threadCount, ids_hash: idsHash },
    selection: { thread_count: threadCount, descendant_thread_count: 0, surviving_descendant_thread_count: 0 },
    blockers: { live_run_count: 0, stopping_run_count: 0, truncated: false },
    preview_marker_unavailable_reason: undefined,
  } };
}

async function mount(screen: Screen, capabilities?: string[], configure?: (db: Awaited<ReturnType<typeof fixtureModel>>["db"]) => void): Promise<Rig> {
  const rig = await fixtureModel({ route: screen === "threads" ? "threads" : "conversation", threadId: "lead", capabilities, configure });
  const host = document.createElement("div");
  document.body.append(host);
  const prefs = signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }]));
  await act(async () => {
    render(<App context={{ model: rig.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => false }} />, host);
    await settle(rig.t, rig.db);
  });
  const list = host.querySelector<HTMLElement>(screen === "threads" ? ".org-rows" : ".side-list");
  if (!list) throw new Error(`Missing real ${screen} thread list`);
  return { ...rig, host, list, screen };
}

function rowLinks(rig: Rig): HTMLAnchorElement[] {
  const idPrefix = rig.screen === "threads" ? "thread-link-page-" : "thread-link-sidebar-";
  return [...rig.list.querySelectorAll<HTMLAnchorElement>("a[id]")].filter((link) => link.id.startsWith(idPrefix));
}

const threadIdOf = (link: HTMLAnchorElement) => decodeURIComponent(link.getAttribute("href")!.split("/").at(-1)!);

async function openDelete(rig: Rig, link: HTMLAnchorElement): Promise<HTMLDialogElement> {
  const row = link.closest<HTMLElement>(rig.screen === "threads" ? "[data-thread-row]" : "[data-thread-row]");
  if (!row) throw new Error("Expected an actual rendered thread row");
  await act(async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 20, clientY: 20 }));
    await Promise.resolve();
  });
  const deleteItem = document.body.querySelector<HTMLElement>(".menu-item.menu-item-destructive");
  if (!deleteItem) throw new Error("Expected the real row menu's destructive Delete item");
  await act(async () => { deleteItem.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  const dialog = rig.host.querySelector<HTMLDialogElement>('dialog[role="alertdialog"]');
  if (!dialog) throw new Error("Expected the mounted ThreadDeleteDialog");
  return dialog;
}

async function resolveListWithout(rig: Rig, threadId: string): Promise<void> {
  await act(async () => {
    delete rig.db.threads[threadId];
    rig.t.push({ t: "changed", config_changed: false, thread_ids: [threadId], list: true });
    await settle(rig.t, rig.db);
  });
}

async function unmount(rig: Rig, outside?: HTMLElement): Promise<void> {
  await act(async () => { render(null, rig.host); });
  rig.model.dispose();
  rig.data.stop();
  rig.host.remove();
  outside?.remove();
}

describe("screen-owned thread-list focus", () => {
  it.each(["sidebar", "threads"] as const)("focuses the next real %s row after a focused row is deleted", async (screen) => {
    const rig = await mount(screen);
    try {
      const [target, next] = rowLinks(rig);
      expect(target).toBeDefined();
      expect(next).toBeDefined();
      const marker = { thread_count: 1, ids_hash: `${screen}-exact` };
      rig.model.ops.threadDeletePreview = vi.fn(async () => preview(marker.thread_count, marker.ids_hash)) as never;
      rig.model.ops.threadDelete = vi.fn(async () => ({ ok: true, value: {} })) as never;
      await act(async () => { target!.focus(); });
      expect(document.activeElement).toBe(target);
      const dialog = await openDelete(rig, target!);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      const confirm = dialog.querySelector<HTMLButtonElement>(".delete-preview button");
      if (!confirm) throw new Error("Confirm missing after preview: " + dialog.textContent);
      await act(async () => { confirm.click(); await Promise.resolve(); });
      expect(dialog.open).toBe(false);
      expect(document.activeElement).toBe(target);
      expect(rig.model.ops.threadDelete).toHaveBeenCalledTimes(1);
      expect(rig.model.ops.threadDelete).toHaveBeenCalledWith(threadIdOf(target!), marker);
      const deletedId = threadIdOf(target!);
      await resolveListWithout(rig, deletedId);
      // Removing a sidebar parent promotes its formerly hidden child into the vacated slot.
      const expected = screen === "sidebar" ? rowLinks(rig).find(link => threadIdOf(link) === "child") : next;
      expect(expected).toBeDefined();
      expect(document.activeElement).toBe(expected);
    } finally { await unmount(rig); }
  });

  it.each(["sidebar", "threads"] as const)("Cancel returns to real row B when focus started outside the %s list", async (screen) => {
    const rig = await mount(screen);
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      const [, rowB] = rowLinks(rig);
      expect(rowB).toBeDefined();
      rig.model.ops.threadDeletePreview = vi.fn(async () => preview(1, "cancel-row-b")) as never;
      outside.focus();
      const dialog = await openDelete(rig, rowB!);
      const cancel = dialog.querySelector<HTMLButtonElement>(".work-sheet-head button")!;
      await act(async () => { cancel.click(); await Promise.resolve(); });
      expect(dialog.isConnected).toBe(false);
      expect(document.activeElement).toBe(rowB);
    } finally { await unmount(rig, outside); }
  });

  it.each(["sidebar", "threads"] as const)("Cancel resolves removed row B to its current position in the %s list", async (screen) => {
    const rig = await mount(screen);
    try {
      const [, rowB, rowC] = rowLinks(rig);
      expect(rowB).toBeDefined();
      expect(rowC).toBeDefined();
      rig.model.ops.threadDeletePreview = vi.fn(async () => preview(1, "cancel-removed-b")) as never;
      const outside = document.createElement("button");
      document.body.append(outside);
      outside.focus();
      const dialog = await openDelete(rig, rowB!);
      const removedId = threadIdOf(rowB!);
      await resolveListWithout(rig, removedId);
      expect(rig.list.contains(rowB!)).toBe(false);
      const cancel = dialog.querySelector<HTMLButtonElement>(".work-sheet-head button")!;
      await act(async () => { cancel.click(); await Promise.resolve(); });
      expect(dialog.isConnected).toBe(false);
      expect(document.activeElement).toBe(rowC);
      outside.remove();
    } finally { await unmount(rig); }
  });

  it("clears the Threads row claim when focus enters a group fold control", async () => {
    const rig = await mount("threads", ["thread.tags"], (db) => {
      (db.threads.lead as { tags?: string[] }).tags = ["focus-test"];
      (db.threads.child as { tags?: string[] }).tags = ["focus-test"];
    });
    try {
      await act(async () => {
        rig.model.org.setGrouping("tag");
        await settle(rig.t, rig.db);
        rig.model.org.headings.toggle("focus-test");
        await settle(rig.t, rig.db);
      });
      const [target] = rowLinks(rig);
      const fold = rig.list.querySelector<HTMLButtonElement>(".tgroup header button");
      expect(target).toBeDefined();
      expect(fold).toBeDefined();
      await act(async () => { target!.focus(); });
      expect(document.activeElement).toBe(target);
      fold!.focus();
      expect(document.activeElement).toBe(fold);
      const deletedId = threadIdOf(target!);
      await resolveListWithout(rig, deletedId);
      expect(document.activeElement).toBe(fold);
    } finally { await unmount(rig); }
  });

  it.each(["sidebar", "threads"] as const)("clears the %s list focus claim after focus leaves the list", async (screen) => {
    const rig = await mount(screen);
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      const [target] = rowLinks(rig);
      expect(target).toBeDefined();
      await act(async () => { target!.focus(); });
      expect(document.activeElement).toBe(target);
      const toolbarControl = screen === "threads" ? rig.host.querySelector<HTMLButtonElement>(".toolbar button")! : rig.host.querySelector<HTMLButtonElement>(".side-controls button[title]")!;
      toolbarControl.focus();
      expect(document.activeElement).toBe(toolbarControl);
      toolbarControl.remove();
      const afterOutsideRemoval = document.activeElement;
      const deletedId = threadIdOf(target!);
      await resolveListWithout(rig, deletedId);
      expect(document.activeElement).toBe(afterOutsideRemoval);
      expect(rig.list.contains(document.activeElement)).toBe(false);
    } finally { await unmount(rig, outside); }
  });

  it("discards a closed slow preview before opening a different row", async () => {
    const rig = await mount("sidebar");
    const pending = new Map<string, (result: PreviewResult) => void>();
    try {
      const [rowA, rowB] = rowLinks(rig);
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      rig.model.ops.threadDeletePreview = vi.fn((threadId: string) => new Promise((resolve) => pending.set(threadId, resolve))) as never;
      rig.model.ops.threadDelete = vi.fn(async () => ({ ok: true, value: {} })) as never;
      const idA = threadIdOf(rowA!);
      const idB = threadIdOf(rowB!);

      const dialogA = await openDelete(rig, rowA!);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(dialogA.textContent).toContain("Loading");
      await act(async () => { dialogA.querySelector<HTMLButtonElement>(".work-sheet-head button")!.click(); });
      expect(dialogA.isConnected).toBe(false);
      expect(document.activeElement).toBe(rowA);

      const dialogB = await openDelete(rig, rowB!);
      await act(async () => { pending.get(idB)?.(preview(22, "marker-B")); await Promise.resolve(); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(dialogB.textContent).toContain("22");
      expect(dialogB.textContent).not.toContain("111");
      await act(async () => { pending.get(idA)?.(preview(111, "marker-A")); await Promise.resolve(); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(dialogB.textContent).toContain("22");
      expect(dialogB.textContent).not.toContain("111");

      const confirm = dialogB.querySelector<HTMLButtonElement>(".delete-preview button");
      if (!confirm) throw new Error("Confirm B missing after preview: " + dialogB.textContent);
      await act(async () => { confirm.click(); await Promise.resolve(); });
      expect(rig.model.ops.threadDelete).toHaveBeenCalledTimes(1);
      expect(rig.model.ops.threadDelete).toHaveBeenCalledWith(idB, { thread_count: 22, ids_hash: "marker-B" });
    } finally { await unmount(rig); }
  });
});
