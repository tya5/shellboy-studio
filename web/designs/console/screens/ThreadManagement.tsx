import { useEffect, useRef, useState } from "preact/hooks";
import { formatRoute, type AppModel } from "../../../ui-core/src";
import { Button, Notice, Section } from "../system/components";
import type { ThreadDetails } from "../../../data/src";

type OwnerIdentity = AppModel["data"]["owner"]["value"];
type DetailState = { id: string; owner: OwnerIdentity; loading: boolean; value?: ThreadDetails; error?: string };
type ActionState = { id: string; owner: OwnerIdentity; kind: "idle" | "running" } | { id: string; owner: OwnerIdentity; kind: "done"; archived: boolean; count: number; already: number; notFound: number } | { id: string; owner: OwnerIdentity; kind: "failed"; message: string };

/** One-thread management entry; route reads and mutations are independent of bulk selection. */
export function ThreadManagement({ model }: { model: AppModel }) {
  const t = model.t.value;
  const id = model.route.value.threadId;
  const owner = model.data.owner.value;
  const session = useRef(0);
  const [detailState, setDetailState] = useState<DetailState>();
  const [actionState, setActionState] = useState<ActionState>({ id: id ?? "", owner, kind: "idle" });
  const currentDetail = detailState?.id === id && detailState.owner === owner ? detailState : undefined;
  const currentAction = actionState.id === id && actionState.owner === owner ? actionState : undefined;

  useEffect(() => {
    let current = true;
    if (!id) return () => { current = false; };
    const readOwner = model.data.owner.value;
    const readSession = ++session.current;
    const currentTarget = () => current && session.current === readSession && model.route.peek().threadId === id && model.data.owner.peek() === readOwner;
    const read = (next: DetailState) => {
      if (currentTarget()) setDetailState(next);
    };
    read({ id, owner: readOwner, loading: true });
    setActionState({ id, owner: readOwner, kind: "idle" });
    void model.ops.threadGet(id).then((out) => {
      if (!currentTarget()) return;
      read(out.ok ? { id, owner: readOwner, loading: false, value: out.value } : { id, owner: readOwner, loading: false, error: out.error.message });
    });
    return () => { current = false; };
  }, [id, model.ops, owner]);

  if (!id) return <Section title={t("view.threads")}><Notice tone="wait">{t("threads.empty")}</Notice></Section>;
  if (!currentDetail || currentDetail.loading) return <Section title={t("view.threads")}><Notice tone="wait">{t("common.loading")}</Notice></Section>;
  if (!currentDetail.value) return <Section title={t("view.threads")}><Notice tone="bad">{currentDetail.error ?? t("threads.empty")}</Notice></Section>;

  const detail = currentDetail.value;
  const archived = detail.archived_at !== undefined;
  const actionable = !currentAction || currentAction.kind === "idle" || currentAction.kind === "done";
  const mutate = async () => {
    const mutationOwner = model.data.owner.peek();
    const mutationId = id;
    const mutationSession = session.current;
    const currentMutation = () => session.current === mutationSession && model.route.peek().threadId === mutationId && model.data.owner.peek() === mutationOwner;
    if (!currentMutation() || currentAction?.kind === "running") return;
    setActionState({ id: mutationId, owner: mutationOwner, kind: "running" });
    const out = archived
      ? await model.ops.threadUnarchive([mutationId], { descendants: false })
      : await model.ops.threadArchive([mutationId], { descendants: false });
    if (!currentMutation()) return;
    if (!out.ok) {
      setActionState({ id: mutationId, owner: mutationOwner, kind: "failed", message: out.error.message });
      return;
    }
    const refreshed = await model.ops.threadGet(mutationId);
    if (!currentMutation()) return;
    if (!refreshed.ok) {
      setActionState({ id: mutationId, owner: mutationOwner, kind: "failed", message: refreshed.error.message });
      return;
    }
    setDetailState({ id: mutationId, owner: mutationOwner, loading: false, value: refreshed.value });
    const result = archived ? out.value.unarchived : out.value.archived;
    setActionState({ id: mutationId, owner: mutationOwner, kind: "done", archived: !archived, count: result?.length ?? 0, already: out.value.already?.length ?? 0, notFound: out.value.not_found?.length ?? 0 });
  };

  return <Section title={detail.title} sub={detail.thread_id} actions={<a class="btn" href={formatRoute({ view: "conversation", threadId: id })}>{t("view.conversation")}</a>}>
    <div class="band" data-thread-management="">
      {actionable ? <Button disabled={currentAction?.kind === "running"} onClick={() => void mutate()}>{archived ? t("org.unarchive") : t("action.archive")}</Button> : null}
    </div>
    {currentAction?.kind === "failed" ? <Notice tone="bad">{currentAction.message}</Notice> : null}
    {currentAction?.kind === "done" ? <>
      <Notice>{currentAction.archived ? t("org.archivedResult", { n: currentAction.count, already: currentAction.already }) : t("org.unarchivedResult", { n: currentAction.count, already: currentAction.already })}</Notice>
      {currentAction.notFound > 0 ? <Notice tone="bad">{t("org.notFound", { n: currentAction.notFound })}</Notice> : null}
    </> : null}
  </Section>;
}
