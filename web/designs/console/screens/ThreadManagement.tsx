import { useEffect, useState } from "preact/hooks";
import { formatRoute, type AppModel } from "../../../ui-core/src";
import { Button, Notice, Section } from "../system/components";
import type { ThreadDetails } from "../../../data/src";

type ActionState = { kind: "idle" | "running" } | { kind: "done"; archived: boolean; count: number } | { kind: "failed"; message: string };

/** One-thread management entry; route reads and mutations are independent of bulk selection. */
export function ThreadManagement({ model }: { model: AppModel }) {
  const t = model.t.value;
  const id = model.route.value.threadId;
  const [detail, setDetail] = useState<ThreadDetails>();
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string>();
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

  useEffect(() => {
    let current = true;
    setDetail(undefined);
    setError(undefined);
    setAction({ kind: "idle" });
    if (!id) {
      setLoading(false);
      return () => { current = false; };
    }
    setLoading(true);
    void model.ops.threadGet(id).then((out) => {
      if (!current) return;
      if (out.ok) setDetail(out.value);
      else setError(out.error.message);
      setLoading(false);
    });
    return () => { current = false; };
  }, [id, model.ops]);

  if (!id) return <Section title={t("view.threads")}><Notice tone="wait">{t("threads.empty")}</Notice></Section>;
  if (loading) return <Section title={t("view.threads")}><Notice tone="wait">{t("common.loading")}</Notice></Section>;
  if (!detail) return <Section title={t("view.threads")}><Notice tone="bad">{error ?? t("threads.empty")}</Notice></Section>;

  const archived = detail.archived_at !== undefined;
  const mutate = async () => {
    if (action.kind === "running") return;
    setAction({ kind: "running" });
    const out = archived
      ? await model.ops.threadUnarchive([id], { descendants: false })
      : await model.ops.threadArchive([id], { descendants: false });
    if (!out.ok) {
      setAction({ kind: "failed", message: out.error.message });
      return;
    }
    const count = (archived ? out.value.unarchived : out.value.archived)?.length ?? 0;
    setAction({ kind: "done", archived: !archived, count });
    const refreshed = await model.ops.threadGet(id);
    if (refreshed.ok) setDetail(refreshed.value);
  };

  return <Section title={detail.title} sub={detail.thread_id} actions={<a class="btn" href={formatRoute({ view: "conversation", threadId: id })}>{t("view.conversation")}</a>}>
    <div class="band" data-thread-management="">
      <Button disabled={action.kind === "running"} onClick={() => void mutate()}>{archived ? t("org.unarchive") : t("action.archive")}</Button>
    </div>
    {action.kind === "failed" ? <Notice tone="bad">{action.message}</Notice> : null}
    {action.kind === "done" ? <Notice>{action.archived ? t("org.archivedResult", { n: action.count, already: 0 }) : t("org.unarchivedResult", { n: action.count, already: 0 })}</Notice> : null}
  </Section>;
}
