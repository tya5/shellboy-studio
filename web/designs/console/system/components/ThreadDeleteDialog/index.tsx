import type { ThreadDeletePreview } from "../../../../../data/src";
import type { AppModel } from "../../../../../ui-core/src";
import { Button, WorkSheet } from "..";
import { useEffect, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../../data/src";

const shown = (value: number | undefined): string => value === undefined ? "Unknown" : String(value);
export function ThreadDeleteDialog({ model, target, onClose }: { model: AppModel; target: ThreadSummary; onClose: () => void }) {
  const [preview, setPreview] = useState<ThreadDeletePreview>();
  useEffect(() => { void model.ops.threadDeletePreview(target.thread_id).then((outcome) => { if (outcome.ok) setPreview(outcome.value); else model.actionError.value = { kind: "error", text: outcome.error.message }; }); }, []);
  const confirm = async () => {
    if (!preview?.deletable_now || !preview.preview_marker) return;
    const outcome = await model.ops.threadDelete(target.thread_id, preview.preview_marker);
    model.actionError.value = outcome.ok ? { kind: "success", text: model.t.value("action.succeeded", { action: model.t.value("thread.deleteConfirm") }) } : { kind: "error", text: outcome.error.message };
    if (outcome.ok) onClose();
  };
  return <WorkSheet open title={model.t.value("thread.deletePreview")} closeLabel={model.t.value("thread.deleteCancel")} onClose={onClose}>{preview ? <div class="delete-preview"><p>{model.t.value("thread.deleteConfirmBody", { n: shown(preview.selection?.thread_count) })}</p><dl><dt>Children</dt><dd>{shown(preview.selection?.descendant_thread_count)}</dd><dt>Surviving children</dt><dd>{shown(preview.selection?.surviving_descendant_thread_count)}</dd></dl><h3>{model.t.value("thread.deleteBlockers")}</h3><dl>{preview.reasons.map((reason) => <><dt>{reason === "live_runs" ? model.t.value("thread.blocker.live") : reason === "stopping_runs" ? model.t.value("thread.blocker.stopping") : reason === "truncated_runs" ? model.t.value("thread.blocker.truncated") : reason === "input_limit" ? model.t.value("thread.blocker.inputLimit") : reason === "incomplete_references" ? model.t.value("thread.blocker.references") : `other reason (${reason})`}</dt><dd>{reason === "live_runs" ? shown(preview.blockers?.live_run_count) : reason === "stopping_runs" ? shown(preview.blockers?.stopping_run_count) : ""}</dd></>)}</dl>{preview.deletable_now && preview.preview_marker ? <Button variant="warn" onClick={() => void confirm()}>{model.t.value("thread.deleteConfirm")}</Button> : <p role="alert">{model.t.value("thread.deleteBlocked")}</p>}</div> : <p>Loading…</p>}</WorkSheet>;
}
