import { useRef, useState } from "preact/hooks";
import { DELETE_SET_LIMIT } from "../../../../../data/src";
import type { AppModel } from "../../../../../ui-core/src";
import { Button } from "../Button";
import { RowCheckbox } from "../SelectRow";
import { SelectionBar } from "../SelectionBar";
import { Notice } from "../Notice";
import { ThreadDeleteDialog } from "../ThreadDeleteDialog";

/** Keeps selection keyed by Thread ID instead of by the sidebar's visible row copies. */
export function useSidebarThreadSelection(model: AppModel, getHeading: () => HTMLElement | null) {
  const t = model.t.value;
  const [selecting, setSelecting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<Map<string, { title: string; archived: boolean }>>(() => new Map());
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [armed, setArmed] = useState<"archive" | "unarchive">();
  const [archiveResult, setArchiveResult] = useState<{ verb: "archive" | "unarchive"; result: { archived?: string[]; unarchived?: string[]; already?: string[]; not_found?: string[] } }>();
  const [archiveError, setArchiveError] = useState<string>();
  const [archiveRunning, setArchiveRunning] = useState(false);
  const archivedIds = [...selected].filter(([, item]) => item.archived).map(([id]) => id);
  const activeIds = [...selected].filter(([, item]) => !item.archived).map(([id]) => id);
  const current = useRef(selected);
  const opener = useRef<HTMLButtonElement>(null);
  const update = (next: Map<string, { title: string; archived: boolean }>) => {
    current.current = next;
    setSelected(next);
    setArmed(undefined);
  };
  const toggle = (id: string, title: string, archived: boolean) => {
    const next = new Map(current.current);
    if (!next.delete(id)) {
      if (next.size >= DELETE_SET_LIMIT) return;
      next.set(id, { title, archived });
    }
    update(next);
  };
  const archive = async (verb: "archive" | "unarchive", ids: string[]) => {
    if (!ids.length) return;
    if (archiveRunning) return;
    if (verb === "archive" && armed !== verb) { setArmed(verb); setArchiveError(undefined); return; }
    setArmed(undefined); setArchiveResult(undefined); setArchiveError(undefined); setArchiveRunning(true);
    try {
      const out = verb === "archive" ? await model.ops.threadArchive(ids, { descendants: includeDescendants }) : await model.ops.threadUnarchive(ids, { descendants: includeDescendants });
      if (!out.ok) { setArchiveError(out.error.message); return; }
      setArchiveResult({ verb, result: out.value });
      for (const id of ((verb === "archive" ? out.value.archived : out.value.unarchived) ?? [])) current.current.delete(id);
      update(new Map(current.current));
    } finally { setArchiveRunning(false); }
  };
  return {
    // App callbacks share a render scope with this object. Keep mounted VNodes out of it.
    start: () => !selecting ? <Button variant="ghost" onClick={() => setSelecting(true)}>{t("thread.deleteSetSelect")}</Button> : null,
    bar: () => selecting ? <>
      <SelectionBar text={t("org.selected", { n: selected.size })} option={{ label: t("org.descendants"), checked: includeDescendants, onChange: value => { setIncludeDescendants(value); setArmed(undefined); } }}>
      {activeIds.length ? <Button variant={armed === "archive" ? "warn" : "outline"} disabled={archiveRunning} onClick={() => void archive("archive", activeIds)}>{t(armed === "archive" ? "org.archiveConfirm" : "action.archive")}</Button> : null}
      {archivedIds.length ? <Button variant="outline" disabled={archiveRunning} onClick={() => void archive("unarchive", archivedIds)}>{t("org.unarchive")}</Button> : null}
      <Button variant="ghost" buttonRef={opener} disabled={!selected.size} onClick={() => setReviewing(true)}>{t("thread.deleteSetAction")}</Button>
      <Button variant="ghost" onClick={() => { update(new Map()); setSelecting(false); setArmed(undefined); }}>{t("common.close")}</Button>
      </SelectionBar>
      {archiveError ? <Notice tone="bad">{t("org.failed", { message: archiveError })}</Notice> : null}
      {archiveResult ? <Notice>{t(archiveResult.verb === "archive" ? "org.archivedResult" : "org.unarchivedResult", { n: (archiveResult.verb === "archive" ? archiveResult.result.archived : archiveResult.result.unarchived)?.length ?? 0, already: archiveResult.result.already?.length ?? 0 })}{archiveResult.result.not_found?.length ? ` ${t("org.notFound", { n: archiveResult.result.not_found.length })}` : ""}</Notice> : null}
    </> : null,
    checkbox: (id: string, title: string, archived: boolean) => selecting ? <RowCheckbox
      checked={selected.has(id)} label={t("org.selectOne", { title })}
      disabled={selected.size >= DELETE_SET_LIMIT && !selected.has(id)} onToggle={() => toggle(id, title, archived)}
    /> : null,
    dialog: (titleOf: (id: string) => string | undefined) => reviewing ? <ThreadDeleteDialog model={model} target={{
      threadIds: [...selected.keys()],
      readSelection: () => [...current.current.keys()],
      titleOf: id => titleOf(id) ?? selected.get(id)?.title,
      onAccepted: ids => {
        const next = new Map(current.current);
        for (const id of ids) next.delete(id);
        update(next);
        if (!next.size) setSelecting(false);
        model.onThreadSetDeleted(ids);
      },
    }} getReturnFocusTarget={() => opener.current && !opener.current.disabled ? opener.current : getHeading()}
      onClose={() => setReviewing(false)} /> : null,
  };
}
