import type { ThreadDeletePreview } from "../../../../../data/src";
import type { AppModel } from "../../../../../ui-core/src";
import { Button, WorkSheet } from "..";
import { useEffect, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../../../data/src";
import type { RowFocusReturn } from "../thread-menu";

const shown = (value: number | undefined): string => value === undefined ? "unknown" : String(value);
export function ThreadDeleteDialog({ model, target, onClose, returnFocusTo, resolveFocusFallback }: { model: AppModel; target: ThreadSummary; onClose: () => void } & RowFocusReturn) {
  const [preview, setPreview] = useState<ThreadDeletePreview>();
  useEffect(() => { void model.ops.threadDeletePreview(target.thread_id).then((outcome) => { if (outcome.ok) setPreview(outcome.value); else model.actionError.value = { kind: "error", text: outcome.error.message }; }); }, []);
  const confirm = () => {
    if (!preview?.deletable_now || !preview.preview_marker) return;
    const threadId = target.thread_id;
    const marker = preview.preview_marker;
    onClose();
    void model.ops.threadDelete(threadId, marker).then((outcome) => {
      model.actionError.value = outcome.ok ? { kind: "success", text: model.t.value("action.succeeded", { action: model.t.value("thread.deleteConfirm") }) } : { kind: "error", text: outcome.error.message };
    });
  };
  return <WorkSheet open role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title={model.t.value("thread.deletePreview")} closeLabel={model.t.value("thread.deleteCancel")} describedBy="thread-delete-description" returnFocusTo={returnFocusTo} resolveFocusFallback={resolveFocusFallback} onClose={onClose}>{preview ? <div class="delete-preview"><p id="thread-delete-description">{model.t.value("thread.deleteConfirmBody", { n: shown(preview.selection?.thread_count) })}</p><dl><dt>Children</dt><dd>{shown(preview.selection?.descendant_thread_count)}</dd><dt>Surviving children</dt><dd>{shown(preview.selection?.surviving_descendant_thread_count)}</dd></dl><h3>{model.t.value("thread.deleteBlockers")}</h3><dl><dt>{model.t.value("thread.blocker.live")}</dt><dd>{shown(preview.blockers.live_run_count)}</dd><dt>{model.t.value("thread.blocker.stopping")}</dt><dd>{shown(preview.blockers.stopping_run_count)}</dd>{preview.blockers.truncated ? <dt>{model.t.value("thread.blocker.truncated")}</dt> : null}{preview.preview_marker_unavailable_reason ? <><dt>{preview.preview_marker_unavailable_reason === "input_limit" ? model.t.value("thread.blocker.inputLimit") : `other reason (${preview.preview_marker_unavailable_reason})`}</dt><dd></dd></> : null}</dl>{preview.deletable_now && preview.preview_marker ? <Button variant="warn" onClick={() => void confirm()}>{model.t.value("thread.deleteConfirm")}</Button> : <p role="alert">{model.t.value("thread.deleteBlocked")}</p>}</div> : <p id="thread-delete-description">Loading…</p>}</WorkSheet>;
}
