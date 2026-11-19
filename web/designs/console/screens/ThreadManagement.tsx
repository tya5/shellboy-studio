import { useEffect } from "preact/hooks";
import { formatRoute, CAPABILITY_REPARENT, type AppModel } from "../../../ui-core/src";
import { Button, Notice, Section, StatusMark } from "../system/components";

/** One-thread management entry; actions reuse the qualified ThreadOrg state/operations. */
export function ThreadManagement({ model }: { model: AppModel }) {
  const t = model.t.value;
  const id = model.route.value.threadId;
  const org = model.org;
  useEffect(() => { org.ensure(); }, [org]);
  const row = id ? org.shown().find(item => item.thread_id === id) : undefined;
  if (!id || !row) return <Section title={t("view.threads")}><Notice tone="wait">{t("threads.empty")}</Notice></Section>;
  const archived = org.state.value.mode === "only";
  const selected = org.selected.value.has(id);
  const action = org.action.value;
  const select = () => { if (!selected) org.toggle(id); };
  const apply = () => { select(); void org.apply(); };
  return <Section title={row.title} sub={row.thread_id} actions={<a class="btn" href={formatRoute({ view: "conversation", threadId: id })}>{t("view.conversation")}</a>}>
    <div class="band" data-thread-management="">
      {row.activity ? <StatusMark status={row.activity} label={row.activity} /> : null}
      <Button disabled={action.kind === "running"} onClick={apply}>{archived ? t("org.unarchive") : t("action.archive")}</Button>
      {model.data.capabilities.value.includes(CAPABILITY_REPARENT) ? <Button variant="link" onClick={() => org.pickParent(id)}>{t("org.move")}</Button> : null}
    </div>
    {action.kind === "failed" ? <Notice tone="bad">{action.error.message}</Notice> : null}
    {action.kind === "done" ? <Notice>{t("org.done")}</Notice> : null}
  </Section>;
}
