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

async function mount(screen: Screen): Promise<Rig> {
  const rig = await fixtureModel({ route: screen === "threads" ? "threads" : "conversation", threadId: "lead" });
  const host = document.createElement("div");
  document.body.append(host);
  const prefs = signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }]));
  await act(async () => {
    render(<App context={{ model: rig.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => false }} />, host);
    await settle(rig.t, rig.db);
  });
  const list = host.querySelector<HTMLElement>(screen === "threads" ? ".org" : ".side-list");
  if (!list) throw new Error(`Missing real ${screen} thread list`);
  return { ...rig, host, list, screen };
}

function rowLinks(rig: Rig): HTMLAnchorElement[] {
  const idPrefix = rig.screen === "threads" ? "thread-link-page-" : "thread-link-sidebar-";
  return [...rig.list.querySelectorAll<HTMLAnchorElement>("a[id]")].filter((link) => link.id.startsWith(idPrefix));
}

async function openDelete(rig: Rig, link: HTMLAnchorElement): Promise<HTMLDialogElement> {
  const row = link.closest<HTMLElement>(rig.screen === "threads" ? ".srow" : ".tree-item");
  if (!row) throw new Error("Expected an actual rendered thread row");
  await act(async () => {
    row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    await Promise.resolve();
  });
  const deleteItem = document.body.querySelector<HTMLElement>(".menu-item.destructive");
  if (!deleteItem) throw new Error("Expected the real row menu's destructive Delete item");
  await act(async () => { deleteItem.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
  const dialog = rig.host.querySelector<HTMLDialogElement>('dialog[role="alertdialog"]');
  if (!dialog) throw new Error("Expected the mounted ThreadDeleteDialog");
  return dialog;
}

async function resolveListWithout(rig: Rig, threadId: string): Promise<void> {
  await act(async () => {
    delete rig.db.threads[threadId];
    rig.t.push({ t: "changed", thread_ids: [threadId], list: true });
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
      expect(rig.model.ops.threadDelete).toHaveBeenCalledWith(target!.id.replace(/^thread-link-(?:sidebar|page)-/, ""), marker);
      const deletedId = target!.id.replace(/^thread-link-(?:sidebar|page)-/, "");
      await resolveListWithout(rig, deletedId);
      expect(document.activeElement).toBe(next);
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
      outside.focus();
      expect(document.activeElement).toBe(outside);
      outside.remove();
      const afterOutsideRemoval = document.activeElement;
      const deletedId = target!.id.replace(/^thread-link-(?:sidebar|page)-/, "");
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
      const idA = rowA!.id.replace("thread-link-sidebar-", "");
      const idB = rowB!.id.replace("thread-link-sidebar-", "");

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
