import { type AppModel } from "../../../../../ui-core/src";
import { Button, Icon, Menu, WorkSheet, type MenuEntry } from "..";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../../data/src";
import type { StatusKey } from "../../../../../ui-core/src/status";

export function ThreadQuickAction({ model, row, status, onMove }: { model: AppModel; row: ThreadSummary; status?: StatusKey; onMove?: () => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>>();
  const root = useRef<HTMLSpanElement>(null);
  const archived = row.archived_at !== undefined;
  const run = async (work: () => Promise<void>) => {
    setOpen(false);
    try { await work(); } catch (error) { model.actionError.value = error instanceof Error ? error.message : String(error); }
  };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const openFromRow = (event: Event) => {
      const opener = (event as CustomEvent<{ opener?: HTMLElement }>).detail?.opener;
      setAnchor(opener ?? element.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]") ?? null);
      setOpen(true);
    };
    element.addEventListener("thread-menu-open", openFromRow);
    return () => element.removeEventListener("thread-menu-open", openFromRow);
  }, []);
  const deletePreview = () => void run(async () => {
    const outcome = await model.ops.threadDeletePreview(row.thread_id);
    if (!outcome.ok) throw new Error(outcome.error.message);
    setPreview(outcome.value);
  });
  const confirmDelete = () => void run(async () => {
    const count = Number(preview?.thread_count);
    const idsHash = typeof preview?.ids_hash === "string" ? preview.ids_hash : "";
    if (!Number.isInteger(count) || count < 1 || !idsHash) throw new Error(model.t.value("thread.deleteBlocked"));
    const outcome = await model.ops.threadDelete(row.thread_id, { thread_count: count, ids_hash: idsHash });
    if (!outcome.ok) throw new Error(outcome.error.message);
    setPreview(undefined);
    await model.data.refreshThreadList();
  });
  const entries: MenuEntry[] = [
    { key: "archive", label: archived ? model.t.value("org.unarchive") : model.t.value("action.archive"), onSelect: () => void run(async () => { const outcome = archived ? await model.ops.threadUnarchive([row.thread_id], { descendants: false }) : await model.ops.threadArchive([row.thread_id], { descendants: false }); if (!outcome.ok) throw new Error(outcome.error.message); }) },
    { key: "stop", label: model.t.value("action.stop"), disabled: status !== "running", onSelect: () => void run(async () => { const details = await model.ops.threadGet(row.thread_id); if (!details.ok || !details.value.run_id) throw new Error(model.t.value("action.stopRefused")); const outcome = await model.ops.runStop(details.value.run_id); if (!outcome.ok) throw new Error(outcome.error.message); }) },
    { key: "retry", label: model.t.value("action.retry"), disabled: status !== "recovery", onSelect: () => void run(() => model.retry(row.thread_id)) },
    ...(onMove ? [{ key: "move", label: model.t.value("org.move"), onSelect: onMove }] : []),
    { key: "actions-separator", separator: true },
    { key: "delete", label: model.t.value("thread.deletePreview"), destructive: true, onSelect: deletePreview },
  ];
  return <>
    <span ref={root} class="thread-menu-anchor">
      <Button icon label={model.t.value("view.threads")} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { setAnchor(event.currentTarget); setOpen((value) => !value); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setAnchor(event.currentTarget); setOpen(true); } }} onContextMenu={(event) => { event.preventDefault(); setAnchor(event.currentTarget); setOpen(true); }}><Icon name="more" small /></Button>
      <Menu open={open} anchor={anchor} entries={entries} onClose={() => setOpen(false)} />
    </span>
    <WorkSheet open={preview !== undefined} title={model.t.value("thread.deletePreview")} closeLabel={model.t.value("thread.deleteCancel")} onClose={() => setPreview(undefined)}>
      {preview ? <><p>{model.t.value("thread.deleteConfirmBody", { n: Number(preview.thread_count) })}</p><pre>{JSON.stringify(preview, null, 2)}</pre><Button variant="warn" onClick={confirmDelete}>{model.t.value("thread.deleteConfirm")}</Button></> : null}
    </WorkSheet>
  </>;
}
