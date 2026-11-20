import { formatRoute, type AppModel } from "../../../../../ui-core/src";
import { Button, Icon } from "..";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../../data/src";
import type { StatusKey } from "../../../../../ui-core/src/status";

type Action = "archive" | "stop" | "retry";

/** Shared row menu: the row remains navigable while mutations stay in one overflow surface. */
export function ThreadQuickAction({ model, row, status, surface, onMove, report }: { model: AppModel; row: ThreadSummary; status: StatusKey | undefined; surface: "sidebar" | "list"; onMove?: () => void; report?: (message: string | undefined) => void }) {
  const [pending, setPending] = useState<Action>();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [sidebarPlacement, setSidebarPlacement] = useState<{ left: number; top: number; width: number; maxHeight: number }>();

  const menu = useRef<HTMLSpanElement>(null);
  const archived = row.archived_at !== undefined;
  const rememberOpener = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    const row = root.current?.closest<HTMLElement>(".srow, .tree-item");
    const candidate = element?.closest("a,button,input,[tabindex]");
    opener.current = candidate instanceof HTMLElement ? candidate : row?.querySelector<HTMLElement>(".tree-main") ?? null;
  };
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ opener?: HTMLElement }>).detail;
      rememberOpener(detail?.opener ?? event.target);
      setOpen(true);
    };
    node.addEventListener("thread-menu-open", show);
    return () => node.removeEventListener("thread-menu-open", show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const node = root.current;
    if (!node) return;
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) closeMenu(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (!open || surface !== "sidebar") { setSidebarPlacement(undefined); return; }
    const anchor = root.current;
    if (!anchor) return;
    const reposition = () => {
      const rect = anchor.getBoundingClientRect();
      const scrollport = anchor.closest<HTMLElement>(".side");
      const portRect = scrollport?.getBoundingClientRect();
      if (portRect && (rect.bottom <= portRect.top || rect.top >= portRect.bottom)) { closeMenu(); return; }
      const viewportWidth = window.innerWidth || 1024;
      const viewportHeight = window.innerHeight || 768;
      const width = Math.min(340, Math.max(1, viewportWidth - 24));
      const minimumHeight = Math.min(80, Math.max(1, viewportHeight - 24));
      const desiredTop = viewportHeight - rect.top - 12 < minimumHeight ? rect.top - minimumHeight : rect.top;
      const top = Math.min(Math.max(12, desiredTop), Math.max(12, viewportHeight - minimumHeight - 12));
      const maxHeight = Math.max(minimumHeight, viewportHeight - top - 12);
      setSidebarPlacement({
        left: Math.min(Math.max(12, rect.right + 8), Math.max(12, viewportWidth - width - 12)),
        top,
        width,
        maxHeight,
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, surface]);
  useEffect(() => {
    if (open) queueMicrotask(() => menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
  }, [open]);
  const run = async (action: Action, work: () => Promise<void>) => {
    if (pending) return;
    setPending(action); setOpen(false); model.actionError.value = undefined; report?.(undefined);
    try { await work(); if (action === "stop") report?.(model.t.value("action.stopAccepted")); }
    catch (error) { model.actionError.value = error instanceof Error ? error.message : String(error); }
    finally { setPending(undefined); }
  };
  const archive = () => void run("archive", async () => {
    const direction = archived ? "unarchive" : "archive";
    const out = archived ? await model.ops.threadUnarchive([row.thread_id], { descendants: false }) : await model.ops.threadArchive([row.thread_id], { descendants: false });
    if (!out.ok) throw new Error(out.error.message);
    const changed = (direction === "archive" ? out.value.archived : out.value.unarchived)?.includes(row.thread_id) === true;
    const already = out.value.already?.includes(row.thread_id) === true;
    if (!changed && !already) throw new Error("Core did not confirm this thread action");
    report?.(direction === "archive" ? model.t.value("org.archivedResult", { n: changed ? 1 : 0, already: already ? 1 : 0 }) : model.t.value("org.unarchivedResult", { n: changed ? 1 : 0, already: already ? 1 : 0 }));
    try { await model.data.refreshThreadList(); await model.org.read(); } catch { /* Core outcome remains authoritative. */ }
  });
  const stop = () => void run("stop", async () => {
    const details = await model.ops.threadGet(row.thread_id);
    if (!details.ok || details.value.thread_id !== row.thread_id || !details.value.run_id) throw new Error(model.t.value("action.stopRefused"));
    const out = await model.ops.runStop(details.value.run_id);
    if (!out.ok) throw new Error(out.error.message);
  });
  const retry = () => void run("retry", async () => { await model.retry(row.thread_id); });
  const closeMenu = (restore = false) => {
    const target = opener.current;
    setOpen(false);
    opener.current = null;
    if (restore) queueMicrotask(() => target?.focus());
  };
  const invokeMenu = (event: Event) => { event.preventDefault(); rememberOpener(event.target); setOpen(true); };
  const label = model.t.value("view.threads");
  const openFromKeyboard = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); rememberOpener(event.currentTarget); setOpen(true); }
  };
  return <span ref={root} class="model-picker-anchor thread-menu-anchor" data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface} onContextMenu={invokeMenu}>
    <Button class="srow-act" icon label={label} title={label} aria-haspopup="menu" aria-expanded={open} onKeyDown={openFromKeyboard} onClick={(event) => { rememberOpener(event.currentTarget); setOpen((value) => !value); }}><Icon name="more" small /></Button>
    {open ? <span ref={menu} role="menu" class="model-picker" style={surface === "sidebar" && sidebarPlacement ? { position: "fixed", left: `${sidebarPlacement.left}px`, top: `${sidebarPlacement.top}px`, right: "auto", width: `${sidebarPlacement.width}px`, maxHeight: `${sidebarPlacement.maxHeight}px` } : undefined} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])]; const index = items.indexOf(event.target as HTMLElement); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
      <a role="menuitem" href={formatRoute({ view: "thread-management", threadId: row.thread_id })}>{model.t.value("view.thread-management")}</a>
      {archived || status === "completed" || status === "stopped" || status === "failed" ? <Button role="menuitem" disabled={pending !== undefined} onClick={archive}>{archived ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button> : null}
      {status === "running" ? <Button role="menuitem" variant="stop" disabled={pending !== undefined} onClick={stop}>{model.t.value("action.stop")}</Button> : null}
      {status === "recovery" ? <Button role="menuitem" variant="warn" disabled={pending !== undefined} onClick={retry}>{model.t.value("action.retry")}</Button> : null}
      {onMove ? <Button role="menuitem" onClick={() => { setOpen(false); onMove(); }}>{model.t.value("org.move")}</Button> : null}
    </span> : null}
  </span>;
}
