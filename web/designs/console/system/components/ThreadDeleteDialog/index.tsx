import type { ThreadDeletePreview } from "../../../../../data/src";
import type { AppModel } from "../../../../../ui-core/src";
import { Button, WorkSheet } from "..";
import { useEffect, useRef, useState } from "preact/hooks";
export type ThreadDeleteTarget = { threadId: string };

const shown = (value: number | undefined): string => value === undefined ? "unknown" : String(value);
export function ThreadDeleteDialog({ model, open, target, getReturnFocusTarget, onClose }: { model: AppModel; open: boolean; target?: ThreadDeleteTarget; getReturnFocusTarget: (threadId: string) => HTMLElement | null; onClose: () => void }) {
  const [preview, setPreview] = useState<ThreadDeletePreview>();
  const returnThreadId = useRef<string>();
  if (open && target) returnThreadId.current = target.threadId;
  useEffect(() => { if (!open || !target) return; setPreview(undefined); void model.ops.threadDeletePreview(target.threadId).then((outcome) => { if (outcome.ok) setPreview(outcome.value); else model.actionError.value = { kind: "error", text: outcome.error.message }; }); }, [model, open, target?.threadId]);
  const confirm = () => {
    if (!target || !preview?.deletable_now || !preview.preview_marker) return;
    const threadId = target.threadId;
    const marker = preview.preview_marker;
    onClose();
    void model.ops.threadDelete(threadId, marker).then((outcome) => {
      model.actionError.value = outcome.ok ? { kind: "success", text: model.t.value("action.succeeded", { action: model.t.value("thread.deleteConfirm") }) } : { kind: "error", text: outcome.error.message };
    });
  };
  return <WorkSheet open={open} role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title={model.t.value("thread.deletePreview")} closeLabel={model.t.value("thread.deleteCancel")} describedBy="thread-delete-description" getReturnFocusTarget={() => returnThreadId.current ? getReturnFocusTarget(returnThreadId.current) : null} onClose={onClose}>{preview ? <div class="delete-preview"><p id="thread-delete-description">{model.t.value("thread.deleteConfirmBody", { n: shown(preview.selection?.thread_count) })}</p><dl><dt>Children</dt><dd>{shown(preview.selection?.descendant_thread_count)}</dd><dt>Surviving children</dt><dd>{shown(preview.selection?.surviving_descendant_thread_count)}</dd></dl><h3>{model.t.value("thread.deleteBlockers")}</h3><dl><dt>{model.t.value("thread.blocker.live")}</dt><dd>{shown(preview.blockers.live_run_count)}</dd><dt>{model.t.value("thread.blocker.stopping")}</dt><dd>{shown(preview.blockers.stopping_run_count)}</dd>{preview.blockers.truncated ? <dt>{model.t.value("thread.blocker.truncated")}</dt> : null}{preview.preview_marker_unavailable_reason ? <><dt>{preview.preview_marker_unavailable_reason === "input_limit" ? model.t.value("thread.blocker.inputLimit") : `other reason (${preview.preview_marker_unavailable_reason})`}</dt><dd></dd></> : null}</dl>{preview.deletable_now && preview.preview_marker ? <Button variant="warn" onClick={() => void confirm()}>{model.t.value("thread.deleteConfirm")}</Button> : <p role="alert">{model.t.value("thread.deleteBlocked")}</p>}</div> : <p id="thread-delete-description">Loading…</p>}</WorkSheet>;
}
