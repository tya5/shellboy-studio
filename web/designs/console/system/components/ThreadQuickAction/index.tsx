import { type AppModel } from "../../../../../ui-core/src";
import { Button, Icon, Menu, WorkSheet, type MenuEntry } from "..";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../../data/src";
import type { StatusKey } from "../../../../../ui-core/src/status";

type DeletePreview = Record<string, unknown> & { deletable_now?: boolean; preview_marker?: { thread_count?: number; ids_hash?: string } | null; selection?: Record<string, unknown>; blockers?: Record<string, unknown>; references?: unknown };

function readable(value: unknown): string { return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value); }

export function ThreadQuickAction({ model, row, status }: { model: AppModel; row: ThreadSummary; status?: StatusKey }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [preview, setPreview] = useState<DeletePreview>();
  const root = useRef<HTMLSpanElement>(null);
  const archived = row.archived_at !== undefined;
  const run = async (work: () => Promise<void>) => {
    setOpen(false);
    model.actionError.value = undefined;
    try { await work(); } catch (error) { model.actionError.value = error instanceof Error ? error.message : String(error); }
  };
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const openFromRow = (event: Event) => {
      const opener = element.querySelector<HTMLButtonElement>("button[aria-haspopup=menu]");
      setAnchor(opener);
      setOpen(true);
    };
    element.addEventListener("thread-menu-open", openFromRow);
    return () => element.removeEventListener("thread-menu-open", openFromRow);
  }, []);
  const deletePreview = () => void run(async () => {
    const outcome = await model.ops.threadDeletePreview(row.thread_id);
    if (!outcome.ok) throw new Error(outcome.error.message);
    setPreview(outcome.value as DeletePreview);
  });
  const confirmDelete = () => void run(async () => {
    if (!preview?.deletable_now) throw new Error(model.t.value("thread.deleteBlocked"));
    const marker = preview.preview_marker;
    if (!marker || typeof marker.thread_count !== "number" || !Number.isInteger(marker.thread_count) || !marker.ids_hash) throw new Error(model.t.value("thread.deleteBlocked"));
    const count = marker.thread_count;
    const outcome = await model.ops.threadDelete(row.thread_id, { thread_count: count, ids_hash: marker.ids_hash });
    if (!outcome.ok) throw new Error(outcome.error.message);
    setPreview(undefined);
  });
  const entries: MenuEntry[] = [
    { key: "archive", label: archived ? model.t.value("org.unarchive") : model.t.value("action.archive"), onSelect: () => void run(async () => { const outcome = archived ? await model.ops.threadUnarchive([row.thread_id], { descendants: false }) : await model.ops.threadArchive([row.thread_id], { descendants: false }); if (!outcome.ok) throw new Error(outcome.error.message); }) },
    { key: "stop", label: model.t.value("action.stop"), disabled: status !== "running", onSelect: () => void run(async () => { const details = await model.ops.threadGet(row.thread_id); if (!details.ok || !details.value.run_id) throw new Error(model.t.value("action.stopRefused")); const outcome = await model.ops.runStop(details.value.run_id); if (!outcome.ok) throw new Error(outcome.error.message); }) },
    { key: "retry", label: model.t.value("action.retry"), disabled: status !== "recovery", onSelect: () => void run(() => model.retry(row.thread_id)) },
    { key: "actions-separator", separator: true },
    { key: "delete", label: model.t.value("thread.deletePreview"), destructive: true, onSelect: deletePreview },
  ];
  return <>
    <span ref={root} class="thread-menu-anchor">
      <Button icon label={model.t.value("thread.rowMenu")} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { setAnchor(event.currentTarget); setOpen((value) => !value); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setAnchor(event.currentTarget); setOpen(true); } }} onContextMenu={(event) => { event.preventDefault(); setAnchor(event.currentTarget); setOpen(true); }}><Icon name="more" small /></Button>
      <Menu open={open} anchor={anchor} entries={entries} onClose={() => setOpen(false)} />
    </span>
    <WorkSheet open={preview !== undefined} title={model.t.value("thread.deletePreview")} closeLabel={model.t.value("thread.deleteCancel")} onClose={() => setPreview(undefined)}>
      {preview ? <div class="delete-preview">
        <p>{model.t.value("thread.deleteConfirmBody", { n: Number((preview.selection?.thread_count ?? preview.preview_marker?.thread_count) ?? 0) })}</p>
        <dl>{Object.entries(preview.selection ?? {}).map(([key, value]) => <><dt>{key}</dt><dd>{readable(value)}</dd></>)}</dl>
        <h3>{model.t.value("thread.deleteBlockers")}</h3>
        <dl>{Object.entries(preview.blockers ?? {}).map(([key, value]) => <><dt>{key}</dt><dd>{readable(value)}</dd></>)}</dl>
        {!preview.deletable_now ? <p role="alert">{model.t.value("thread.deleteBlocked")}</p> : <Button variant="warn" onClick={confirmDelete}>{model.t.value("thread.deleteConfirm")}</Button>}
      </div> : null}
    </WorkSheet>
  </>;
}
