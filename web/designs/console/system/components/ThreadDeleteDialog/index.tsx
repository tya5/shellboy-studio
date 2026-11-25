import { DELETE_SET_LIMIT, type ThreadDeleteSetPreview, type ThreadDeletePreview } from "../../../../../data/src";
import type { ComponentChildren } from "preact";
import type { AppModel } from "../../../../../ui-core/src";
import { Button } from "../Button";
import { WorkSheet } from "../WorkSheet";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
export type ThreadDeleteTarget = { threadId: string };

type SheetProps = { model: AppModel; getReturnFocusTarget: () => HTMLElement | null; onClose: () => void };
function DeleteSheet({ model, getReturnFocusTarget, onClose, children }: SheetProps & { children: ComponentChildren }) {
  const t = model.t.value;
  return <WorkSheet open role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title={t("thread.deletePreview")} closeLabel={t("thread.deleteCancel")} describedBy="thread-delete-description" getReturnFocusTarget={getReturnFocusTarget} onClose={onClose}>{children}</WorkSheet>;
}

type SetTarget = { threadIds: readonly string[]; readSelection: () => readonly string[]; titleOf: (id: string) => string | undefined; onAccepted: (ids: readonly string[]) => void };
export function ThreadDeleteDialog({ target, model, getReturnFocusTarget, onClose }: { target: ThreadDeleteTarget | SetTarget; model: AppModel; getReturnFocusTarget: (id: string) => HTMLElement | null; onClose: () => void }) {
  if ("threadIds" in target) return <SetDeleteDialog model={model} target={target} getReturnFocusTarget={() => getReturnFocusTarget(target.threadIds[0] ?? "")} onClose={onClose} />;
  return <SingleDeleteDialog model={model} target={target} getReturnFocusTarget={getReturnFocusTarget} onClose={onClose} />;
}

function SetDeleteDialog({ target, ...sheet }: SheetProps & { target: SetTarget }) {
  const { model, onClose } = sheet;
  const t = model.t.value;
  const ids = [...target.threadIds].sort();
  const key = JSON.stringify(ids);
  const [preview, setPreview] = useState<ThreadDeleteSetPreview>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const ready = useRef<ThreadDeleteSetPreview>();
  const committing = useRef(false);
  const resume = useRef<() => void>();
  const alive = useRef(false);
  const current = useRef(target);
  current.current = target;
  const sameSelection = () => JSON.stringify([...current.current.readSelection()].sort()) === key;
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => {
    let closed = false, inFlight = false, dirty = true;
    const clear = () => { ready.current = undefined; setPreview(undefined); };
    const refresh = () => {
      clear();
      dirty = true;
      if (inFlight || committing.current || !sameSelection() || model.connection.peek() !== "connected" || !ids.length || ids.length > DELETE_SET_LIMIT) return;
      inFlight = true;
      dirty = false;
      void model.ops.threadDeleteSetPreview(ids).then(out => {
        inFlight = false;
        if (closed) return;
        if (dirty) { refresh(); return; }
        if (!sameSelection() || model.connection.peek() !== "connected") return;
        if (out.ok) { ready.current = out.value; setPreview(out.value); }
        else setError(out.error.message);
      });
    };
    resume.current = refresh;
    setError(undefined);
    let lastHint = model.data.deletePreviewHint.peek();
    const stop = model.data.deletePreviewHint.subscribe(hint => {
      if (hint === lastHint) return;
      lastHint = hint;
      if (!hint.ids || ids.some(id => hint.ids?.includes(id))) refresh();
    });
    const stopConnection = model.connection.subscribe(refresh);
    return () => { closed = true; ready.current = undefined; stop(); stopConnection(); };
  }, [model, key]);

  const confirm = () => {
    const observed = ready.current;
    if (!observed?.deletable_now || committing.current || !sameSelection() || model.connection.peek() !== "connected") return;
    committing.current = true;
    ready.current = undefined;
    setPending(true);
    setError(undefined);
    void model.ops.threadDeleteSet(ids, observed.preview_marker).then(out => {
      committing.current = false;
      if (out.ok) {
        current.current.onAccepted(ids);
        model.actionError.value = { kind: "success", text: t("thread.deleteDone") };
        if (alive.current) onClose();
      } else if (alive.current) {
        setPending(false);
        if (out.error.kind === "owner" && ["preview_stale", "invalid_state", "thread_not_found"].includes(out.error.code)) {
          setError(out.error.message);
          resume.current?.();
        } else {
          // An unconfirmed mutation is not permission to send a second delete.
          setPreview(undefined);
          setError(out.error.message);
          if (out.error.kind === "unconfirmed") committing.current = true;
          else resume.current?.();
        }
      }
    });
  };
  return <DeleteSheet {...sheet} onClose={() => { if (!pending) onClose(); }}>
    <div class="delete-preview delete-preview-set">
      <p id="thread-delete-description">{t("thread.deleteSetScope", { n: ids.length })}</p>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <p role="status">{t("thread.deleteSetPending")}</p> :
        ids.length > DELETE_SET_LIMIT ? <p role="alert">{t("thread.blocker.inputLimit")}</p> : !ids.length ? null : preview ? <>
          <ul role="list">{preview.targets.map(row => <li key={row.thread_id}>
            <p><strong>{target.titleOf(row.thread_id) ?? row.thread_id}</strong> <code>{row.thread_id}</code></p>
            <p>{t("thread.deleteBlockerCounts", { live: row.live_run_count, stopping: row.stopping_run_count })}</p>
            {row.runs.length ? <ul>{row.runs.map(run => <li key={run.id}><code>{run.id}</code> {t(run.state === "live" ? "thread.blocker.live" : "thread.blocker.stopping")}</li>)}</ul> : null}
            {row.runs_more ? <p>{t("thread.blocker.truncated")}</p> : null}
            {row.scheduled_execution_count ? <><p>{t("thread.deleteSetScheduled", { n: row.scheduled_execution_count })}</p><ul>{row.scheduled_execution_ids.map(id => <li key={id}><code>{id}</code></li>)}</ul></> : null}
            {row.scheduled_executions_more ? <p>{t("thread.blocker.truncated")}</p> : null}
          </li>)}</ul>
          {preview.deletable_now ? <Button variant="warn" onClick={confirm}>{t("thread.deleteSetConfirm")}</Button> : <p role="alert">{t("thread.deleteBlocked")}</p>}
        </> : !error ? <p role="status">{t("common.loading")}</p> : null}
    </div>
  </DeleteSheet>;
}

const shown = (value: number | undefined): string => value === undefined ? "unknown" : String(value);
function SingleDeleteDialog({ model, target, getReturnFocusTarget, onClose }: { model: AppModel; target: ThreadDeleteTarget; getReturnFocusTarget: (threadId: string) => HTMLElement | null; onClose: () => void }) {
  const [preview, setPreview] = useState<ThreadDeletePreview>();
  useEffect(() => { void model.ops.threadDeletePreview(target.threadId).then((outcome) => { if (outcome.ok) setPreview(outcome.value); else model.actionError.value = { kind: "error", text: outcome.error.message }; }); }, [model, target.threadId]);
  const confirm = () => {
    if (!preview?.deletable_now || !preview.preview_marker) return;
    const threadId = target.threadId;
    const marker = preview.preview_marker;
    onClose();
    void model.ops.threadDelete(threadId, marker).then((outcome) => {
      model.actionError.value = outcome.ok ? { kind: "success", text: model.t.value("action.succeeded", { action: model.t.value("thread.deleteConfirm") }) } : { kind: "error", text: outcome.error.message };
    });
  };
  return <DeleteSheet model={model} getReturnFocusTarget={() => getReturnFocusTarget(target.threadId)} onClose={onClose}>{preview ? <div class="delete-preview"><p id="thread-delete-description">{model.t.value("thread.deleteConfirmBody", { n: shown(preview.selection?.thread_count) })}</p><dl><dt>Children</dt><dd>{shown(preview.selection?.descendant_thread_count)}</dd><dt>Surviving children</dt><dd>{shown(preview.selection?.surviving_descendant_thread_count)}</dd></dl><h3>{model.t.value("thread.deleteBlockers")}</h3><dl><dt>{model.t.value("thread.blocker.live")}</dt><dd>{shown(preview.blockers.live_run_count)}</dd><dt>{model.t.value("thread.blocker.stopping")}</dt><dd>{shown(preview.blockers.stopping_run_count)}</dd>{preview.blockers.truncated ? <dt>{model.t.value("thread.blocker.truncated")}</dt> : null}{preview.preview_marker_unavailable_reason ? <><dt>{preview.preview_marker_unavailable_reason === "input_limit" ? model.t.value("thread.blocker.inputLimit") : `other reason (${preview.preview_marker_unavailable_reason})`}</dt><dd></dd></> : null}</dl>{preview.deletable_now && preview.preview_marker ? <Button variant="warn" onClick={() => void confirm()}>{model.t.value("thread.deleteConfirm")}</Button> : <p role="alert">{model.t.value("thread.deleteBlocked")}</p>}</div> : <p id="thread-delete-description">Loading…</p>}</DeleteSheet>;
}
