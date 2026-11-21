import type { ThreadDeletePreview } from "../../../../../data/src";
import type { AppModel } from "../../../../../ui-core/src";
import { Button, WorkSheet } from "..";
import { useEffect, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../../data/src";

const shown = (value: number | undefined): string => value === undefined ? "Unknown" : String(value);
export function ThreadDeleteDialog({ model, thread, onClose }: { model: AppModel; thread: ThreadSummary | undefined; onClose: () => void }) {
  const [preview, setPreview] = useState<ThreadDeletePreview>();
  useEffect(() => { setPreview(undefined); if (thread) void model.ops.threadDeletePreview(thread.thread_id).then((outcome) => { if (outcome.ok) setPreview(outcome.value); else model.actionError.value = outcome.error.message; }); }, [model, thread]);
  const confirm = async () => {
    if (!thread || !preview?.deletable_now || !preview.preview_marker) return;
    const outcome = await model.ops.threadDelete(thread.thread_id, preview.preview_marker);
    model.actionError.value = outcome.ok ? `ok:${model.t.value("action.succeeded", { action: model.t.value("thread.deleteConfirm") })}` : outcome.error.message;
    if (outcome.ok) onClose();
  };
  return <WorkSheet open={thread !== undefined} title={model.t.value("thread.deletePreview")} closeLabel={model.t.value("thread.deleteCancel")} onClose={onClose}>{preview ? <div class="delete-preview"><p>{model.t.value("thread.deleteConfirmBody", { n: shown(preview.selection?.thread_count) })}</p><dl><dt>Children</dt><dd>{shown(preview.selection?.descendant_thread_count)}</dd><dt>Surviving children</dt><dd>{shown(preview.selection?.surviving_descendant_thread_count)}</dd></dl><h3>{model.t.value("thread.deleteBlockers")}</h3><dl>{Object.entries(preview.blockers ?? {}).map(([key, value]) => <><dt>{key}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></>)}</dl>{preview.deletable_now && preview.preview_marker ? <Button variant="warn" onClick={() => void confirm()}>{model.t.value("thread.deleteConfirm")}</Button> : <p role="alert">{model.t.value("thread.deleteBlocked")}</p>}</div> : <p>Loading…</p>}</WorkSheet>;
}
