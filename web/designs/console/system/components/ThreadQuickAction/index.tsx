import { formatRoute, type AppModel } from "../../../../ui-core/src";
import { Button, Icon } from "..";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../data/src";
import type { StatusKey } from "../../../../ui-core/src/status";

type Action = "archive" | "stop" | "retry";

/** Shared row menu: the row remains navigable while mutations stay in one overflow surface. */
export function ThreadQuickAction({ model, row, status, surface }: { model: AppModel; row: ThreadSummary; status: StatusKey | undefined; surface: "sidebar" | "list" }) {
  const [pending, setPending] = useState<Action>();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  const archived = row.archived_at !== undefined;
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const show = () => setOpen(true);
    node.addEventListener("thread-menu-open", show);
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => { node.removeEventListener("thread-menu-open", show); document.removeEventListener("pointerdown", outside); };
  }, []);
  const run = async (action: Action, work: () => Promise<void>) => {
    if (pending) return;
    setPending(action); setOpen(false); model.actionError.value = undefined;
    try { await work(); }
    catch (error) { model.actionError.value = error instanceof Error ? error.message : String(error); }
    finally { setPending(undefined); }
  };
  const archive = () => void run("archive", async () => {
    const out = archived ? await model.ops.threadUnarchive([row.thread_id], { descendants: false }) : await model.ops.threadArchive([row.thread_id], { descendants: false });
    if (!out.ok) throw new Error(out.error.message);
    try { await model.data.refreshThreadList(); await model.org.read(); } catch { /* Core outcome remains authoritative. */ }
  });
  const stop = () => void run("stop", async () => {
    const details = await model.ops.threadGet(row.thread_id);
    if (!details.ok || details.value.thread_id !== row.thread_id || !details.value.run_id) throw new Error(model.t.value("action.stopRefused"));
    const out = await model.ops.runStop(details.value.run_id);
    if (!out.ok) throw new Error(out.error.message);
  });
  const retry = () => void run("retry", async () => { await model.retry(row.thread_id); });
  const invokeMenu = (event: Event) => { event.preventDefault(); setOpen(true); };
  const label = model.t.value("view.threads");
  const openFromKeyboard = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
  };
  return <span ref={root} data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface} onContextMenu={invokeMenu}>
    <Button class="srow-act" icon label={label} title={label} aria-haspopup="menu" aria-expanded={open} onKeyDown={openFromKeyboard} onClick={() => setOpen((value) => !value)}><Icon name="menu" small /></Button>
    {open ? <span ref={menu} role="menu" class="thread-menu" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])]; const index = items.indexOf(event.target as HTMLElement); items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
      <a role="menuitem" href={formatRoute({ view: "thread-management", threadId: row.thread_id })}>{label}</a>
      {status === "completed" || status === "stopped" || status === "failed" ? <Button role="menuitem" disabled={pending !== undefined} onClick={archive}>{archived ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button> : null}
      {status === "running" ? <Button role="menuitem" variant="stop" disabled={pending !== undefined} onClick={stop}>{model.t.value("action.stop")}</Button> : null}
      {status === "recovery" ? <Button role="menuitem" variant="warn" disabled={pending !== undefined} onClick={retry}>{model.t.value("action.retry")}</Button> : null}
    </span> : null}
  </span>;
}
