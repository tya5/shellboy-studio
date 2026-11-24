import { useEffect, useState } from "preact/hooks";
import type { AppModel, TagInvalid } from "../../../../../ui-core/src";
import { Button } from "../Button";
import { ButtonGroup } from "../ButtonGroup";
import { Field } from "../Field";
import { Notice } from "../Notice";
import { Section } from "../Section";

/** Edits one Thread's tags from its existing row menu. */
export function ThreadTagEditor({ model, threadId }: { model: AppModel; threadId: string }) {
  const row = model.data.threadRows.value.get(threadId);
  if (!row) return null;
  const t = model.t.value;
  const org = model.threadActions;
  const draft = org.tagDraft.value;
  const action = draft.action;
  const applying = action.kind === "running";
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<TagInvalid | undefined>();
  useEffect(() => { setText(""); setProblem(undefined); }, [draft.id]);
  if (!draft.open) return null;
  const present = row.tags ?? [];
  const add = (raw: string) => {
    if (applying) return;
    const why = org.addTag(raw);
    setProblem(why);
    if (!why) setText("");
  };
  return <Section title={t("org.tag.title", { n: 1 })} sub={t("org.tag.sub")} actions={<Button variant="ghost" onClick={() => org.openTags(false)}>{t("common.close")}</Button>}>
    <div class="band">
      <Field ariaLabel={t("org.tag.add")} placeholder={t("org.tag.add")} value={text} disabled={applying} onInput={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(text); }} />
      <Button disabled={applying} onClick={() => add(text)}>{t("org.tag.addButton")}</Button>
    </div>
    {problem ? <Notice tone="bad">{t(`org.tag.invalid.${problem}`)}</Notice> : null}
    {draft.add.length ? <ButtonGroup label={t("org.tag.toAdd")}>{draft.add.map(tag => <Button key={tag} disabled={applying} aria-pressed onClick={() => org.unaddTag(tag)}>{tag}</Button>)}</ButtonGroup> : null}
    {present.length ? <ButtonGroup label={t("org.tag.toRemove")}>{present.map(tag => <Button key={tag} disabled={applying} aria-pressed={draft.remove.has(tag)} onClick={() => org.toggleRemoveTag(tag)}>{tag}</Button>)}</ButtonGroup> : <div class="muted caption">{t("org.tag.noneToRemove")}</div>}
    <div class="band"><Button variant="primary" disabled={applying || (!draft.add.length && !draft.remove.size)} onClick={() => void org.applyTags()}>{t("org.tag.apply", { n: 1 })}</Button></div>
    {applying ? <p role="status">{t("org.tag.applying")}</p> : null}
    {action.kind === "failed" ? <Notice tone="bad">{t(action.limit ? "org.tag.limit" : "org.tag.failed", { message: action.message })}</Notice> : null}
    {action.kind === "missing" ? <Notice tone="wait">{t("org.tag.missing", { targets: action.targets.join(", ") })}</Notice> : null}
  </Section>;
}
