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
      const toolbarControl = screen === "threads" ? rig.host.querySelector<HTMLButtonElement>(".choice-row button")! : rig.host.querySelector<HTMLButtonElement>(".side-controls button[title]")!;
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

it("shows LoadingRows inside a Threads member band while its first member read is pending", async () => {
  const f = await fixtureModel({ route: "threads", capabilities: ["thread.cwds"] });
  const host = document.createElement("div");
  document.body.append(host);
  const prefs = signal(loadPrefs({ read: () => null, write() {} }, DESIGNS));
  const cwd = "/home/me/dev/shellboy";
  f.model.org.groupBy.value = "directory";
  f.model.org.headings.headings.value = { kind: "cwd", names: [cwd], nextCursor: undefined, pages: 1, loading: false, loaded: true, error: undefined };
  try {
    await act(async () => {
      render(<App context={{ model: f.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => false }} />, host);
    });
    await act(async () => {
      f.model.org.headings.toggle(cwd);
    });
    const band = host.querySelector<HTMLElement>(`.org .tgroup[aria-label="${cwd}"]`)!;
    expect(band).toBeTruthy();
    expect(band.querySelector(".tgroup-count")?.textContent).not.toMatch(/[0-9]/);
    expect(band.querySelector(".tgroup-toggle")?.getAttribute("aria-busy")).toBe("true");
    expect(band.querySelector(".loadrows")).toBeTruthy();
    expect(f.t.calls("thread.list").some(call => (call.args as { cwd?: string }).cwd === cwd)).toBe(true);
  } finally {
    render(null, host);
    host.remove();
    f.model.dispose();
    f.data.stop();
  }
});

describe("sidebar exact-set delete", () => {
  const marker = { thread_count: 2, ids_hash: "a".repeat(64) };
  async function setup() {
    let blocker = false;
    let refusal: "preview_stale" | "invalid_state" | undefined;
    let wrongSet = false;
    const rig = await mount("sidebar", undefined, db => {
      const answer = db.answer.bind(db);
      db.answer = call => {
        if (call.command === "thread.delete_set_preview") {
          const ids = wrongSet ? ["broken", "child"] : (call.args as { thread_ids: string[] }).thread_ids;
          return { ok: true, result: { thread_ids: ids, preview_marker: { ...marker, thread_count: ids.length }, deletable_now: !blocker, targets: ids.map(id => {
            const blocked = blocker && id === "lead";
            return { thread_id: id, live_run_count: 0, stopping_run_count: +blocked, runs: blocked ? [{ id: "synthetic-run", state: "stopping" }] : [], runs_more: false,
              scheduled_execution_count: 0, scheduled_execution_ids: [], scheduled_executions_more: false };
          }) } };
        }
        if (call.command === "thread.delete_set") {
          expect(call.args).toEqual({ thread_ids: ["broken", "lead"], preview_marker: marker });
          if (refusal) return { ok: false, code: refusal };
          delete db.threads.broken;
          delete db.threads.lead;
          return { ok: true, result: { accepted: true } };
        }
        return answer(call);
      };
    });
    const button = (text: string) => [...rig.host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text);
    const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); await act(async () => { await settle(rig.t, rig.db); }); };
    const select = (title: string) => rig.list.querySelector<HTMLInputElement>(`input[aria-label="Select ${title}"]`)!;
    const open = async () => {
      await click(button("Select Threads")!);
      await click(select("Improve history search"));
      await click(select("Check embedding endpoint"));
      await click(button("Delete")!);
      expect(rig.t.calls("thread.delete_set_preview").map(c => c.args)).toEqual([{ thread_ids: ["broken", "lead"] }]);
    };
    const hint = async (id: string) => { await act(async () => {
      rig.t.push({ t: "changed", config_changed: false, thread_ids: [id], list: true });
      await settle(rig.t, rig.db);
    }); };
    return { rig, open, button, click, hint, select, block: () => { blocker = true; }, wrongSet: () => { wrongSet = true; }, refuse: (code: typeof refusal) => { refusal = code; } };
  }

  it("does not mutate on preview or Cancel, then sends one exact commit on explicit confirmation", async () => {
    const { rig, open, button, click, hint } = await setup();
    try {
      await open();
      expect(rig.host.querySelector(".delete-preview")?.textContent).toContain("Unselected descendants will remain");
      expect(rig.host.querySelector(".delete-preview")?.textContent).toContain("Improve history search");
      expect(rig.t.calls("thread.delete_set")).toHaveLength(0);
      await click(button("Cancel")!);
      expect(rig.db.threads).toHaveProperty("lead");
      expect(rig.db.threads).toHaveProperty("broken");
      expect(rig.t.calls("thread.delete_set")).toHaveLength(0);
      await click(button("Delete")!);
      await click(button("Delete selected Threads")!);
      expect(rig.t.calls("thread.delete_set")).toHaveLength(1);
      expect(rig.t.calls("thread.delete")).toHaveLength(0);
      expect(rig.db.threads).not.toHaveProperty("lead");
      expect(rig.db.threads).not.toHaveProperty("broken");
      expect(rig.db.threads).toHaveProperty("child");
      expect(rig.list.textContent).toContain("Improve history search");
      await hint("lead");
      expect(rig.list.textContent).not.toContain("Improve history search");
    } finally { await unmount(rig); }
  });

  it.each(["preview_stale", "invalid_state"] as const)("keeps both Threads and requests a new preview after %s", async code => {
    const { rig, open, button, click, refuse } = await setup();
    try {
      await open();
      refuse(code);
      await click(button("Delete selected Threads")!);
      expect(rig.t.calls("thread.delete_set")).toHaveLength(1);
      expect(rig.t.calls("thread.delete")).toHaveLength(0);
      expect(rig.db.threads).toHaveProperty("lead");
      expect(rig.db.threads).toHaveProperty("broken");
      expect(rig.t.calls("thread.delete_set_preview")).toHaveLength(2);
      expect(button("Delete selected Threads")).toBeDefined();
    } finally { await unmount(rig); }
  });

  it("re-previews a changed target and prevents confirmation when one Thread has a stopping Run", async () => {
    const { rig, open, hint, block, button } = await setup();
    try {
      await open();
      await hint("child");
      expect(rig.t.calls("thread.delete_set_preview")).toHaveLength(1);
      block();
      await hint("lead");
      expect(rig.t.calls("thread.delete_set_preview")).toHaveLength(2);
      expect(rig.host.querySelector(".delete-preview")?.textContent).toContain("synthetic-run");
      expect(button("Delete selected Threads")).toBeUndefined();
      expect(rig.t.calls("thread.delete_set")).toHaveLength(0);
    } finally { await unmount(rig); }
  });

  it("discards the old scope and requires explicit confirmation after selection changes", async () => {
    const { rig, open, click, button, select } = await setup();
    try {
      await open();
      await click(select("Improve history search"));
      expect(rig.t.calls("thread.delete_set_preview").map(c => c.args)).toEqual([
        { thread_ids: ["broken", "lead"] }, { thread_ids: ["broken"] },
      ]);
      expect(rig.host.querySelector(".delete-preview")?.textContent).not.toContain("Improve history search");
      expect(button("Delete selected Threads")).toBeDefined();
      expect(rig.t.calls("thread.delete_set")).toHaveLength(0);
    } finally { await unmount(rig); }
  });

  it("rejects a response that substitutes an unselected descendant", async () => {
    const { rig, open, wrongSet, button } = await setup();
    try {
      wrongSet();
      await open();
      expect(rig.host.querySelector(".delete-preview")?.textContent).toContain("mismatched exact-set deletion preview");
      expect(button("Delete selected Threads")).toBeUndefined();
      expect(rig.t.calls("thread.delete_set")).toHaveLength(0);
    } finally { await unmount(rig); }
  });
});
