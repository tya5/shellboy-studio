import { useRef, useState } from "preact/hooks";
import { DELETE_SET_LIMIT } from "../../../../../data/src";
import type { AppModel } from "../../../../../ui-core/src";
import { Button } from "../Button";
import { RowCheckbox } from "../SelectRow";
import { SelectionBar } from "../SelectionBar";
import { ThreadDeleteDialog } from "../ThreadDeleteDialog";

/** Keeps selection keyed by Thread ID instead of by the sidebar's visible row copies. */
export function useSidebarThreadSelection(model: AppModel, getHeading: () => HTMLElement | null) {
  const t = model.t.value;
  const [selecting, setSelecting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [selected, setSelected] = useState<Map<string, string>>(() => new Map());
  const current = useRef(selected);
  const opener = useRef<HTMLButtonElement>(null);
  const update = (next: Map<string, string>) => {
    current.current = next;
    setSelected(next);
  };
  const toggle = (id: string, title: string) => {
    const next = new Map(current.current);
    if (!next.delete(id)) {
      if (next.size >= DELETE_SET_LIMIT) return;
      next.set(id, title);
    }
    update(next);
  };
  return {
    start: !selecting ? <Button variant="ghost" onClick={() => setSelecting(true)}>{t("thread.deleteSetSelect")}</Button> : null,
    bar: selecting ? <SelectionBar text={t("org.selected", { n: selected.size })}>
      <Button variant="ghost" buttonRef={opener} disabled={!selected.size} onClick={() => setReviewing(true)}>{t("thread.deleteSetAction")}</Button>
      <Button variant="ghost" onClick={() => { update(new Map()); setSelecting(false); }}>{t("common.close")}</Button>
    </SelectionBar> : null,
    checkbox: (id: string, title: string) => selecting ? <RowCheckbox
      checked={selected.has(id)} label={t("org.selectOne", { title })}
      disabled={selected.size >= DELETE_SET_LIMIT && !selected.has(id)} onToggle={() => toggle(id, title)}
    /> : null,
    dialog: (titleOf: (id: string) => string | undefined) => reviewing ? <ThreadDeleteDialog model={model} target={{
      threadIds: [...selected.keys()],
      readSelection: () => [...current.current.keys()],
      titleOf: id => titleOf(id) ?? selected.get(id),
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
