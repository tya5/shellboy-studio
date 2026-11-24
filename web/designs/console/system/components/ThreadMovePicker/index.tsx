import { useState } from "preact/hooks";
import type { AppModel } from "../../../../../ui-core/src";
import { Button } from "../Button";
import { Field } from "../Field";
import { Notice } from "../Notice";
import { Section } from "../Section";

/** Existing Thread parent picker, launched by the sidebar row menu's Move action. */
export function ThreadMovePicker({ model }: { model: AppModel }) {
  const t = model.t.value;
  const org = model.threadActions;
  const move = org.move.value;
  const [filter, setFilter] = useState("");
  if (move.kind === "idle") return null;
  const rows = [...model.data.threadRows.value.values()];
  const titleOf = (id: string) => rows.find(r => r.thread_id === id)?.title ?? id.slice(0, 8);
  const self = rows.find(r => r.thread_id === move.threadId);
  const title = move.kind === "picking" ? (move.title ?? titleOf(move.threadId)) : titleOf(move.threadId);
  const close = <Button variant="ghost" onClick={() => org.cancelMove()}>{t("common.close")}</Button>;
  if (move.kind === "picking") {
    const shown = rows.filter(r => r.thread_id !== move.threadId && r.title.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 50);
    return <Section title={t("org.moveTitle", { title })} actions={close}>
      <Field ariaLabel={t("org.moveFilter")} placeholder={t("org.moveFilter")} value={filter} onInput={e => setFilter(e.currentTarget.value)} />
      <div class="thread-move-list"><div class="band"><Button onClick={() => org.previewMove(move.threadId, "")}>{t("org.noParent")}</Button>
        {shown.map(r => <Button key={r.thread_id} disabled={move.kind === "picking" && move.parentId === r.thread_id} aria-pressed={self?.parent_id === r.thread_id} onClick={() => org.previewMove(move.threadId, r.thread_id)}>{r.title}</Button>)}
      </div></div>
    </Section>;
  }
  const text = move.parent === "" ? t("org.previewDetach", { title }) : t("org.previewUnder", { title, parent: titleOf(move.parent) });
  if (move.kind === "moved") return <Notice actions={close}>{t("org.moved", { title })}</Notice>;
  return <Section title={text} sub={t("org.previewNote")} actions={close}>
    {move.kind === "refused" ? <Notice tone="bad">{t("org.moveRefused", { message: move.message })}</Notice> : null}
    {move.kind !== "refused" ? <div class="band"><Button variant="warn" disabled={move.kind === "moving"} onClick={() => void org.confirmMove()}>{t("org.confirmMove")}</Button></div> : null}
  </Section>;
}
