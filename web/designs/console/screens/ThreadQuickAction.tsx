import { useEffect } from "preact/hooks";
import { type AppModel, type Route } from "../../../ui-core/src";
import { Button, Notice } from "../system/components";
import type { ThreadSummary } from "../../../data/src";

type Target = { id: string; archived: boolean; route: Route; owner: AppModel["data"]["owner"]["value"] };

/** One row-qualified archive action shared by sidebar and the Threads list. */
export function ThreadQuickAction({ model, row, surface }: { model: AppModel; row: ThreadSummary; surface: "sidebar" | "list" }) {
  model.quickActionEpoch.value;
  const target: Target = { id: row.thread_id, archived: row.archived_at !== undefined, route: model.route.value, owner: model.data.owner.value };
  const status = model.threadQuickActionStatus(target.owner as object, target.id);
  const liveRow = () => (surface === "sidebar" ? model.data.threadList.peek().items : model.org.shown()).find((item) => item.thread_id === target.id);
  const current = () => {
    const live = liveRow();
    return model.route.peek() === target.route && model.route.peek().view === target.route.view && model.data.owner.peek() === target.owner && live !== undefined && (live.archived_at !== undefined) === target.archived;
  };

  useEffect(() => { model.threadQuickActionReset(target.owner as object, target.id); }, [row.thread_id, row.archived_at, target.route, target.owner]);

  const run = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!current()) return;
    const token = model.threadQuickActionAdmit(target.owner as object, target.id);
    if (!token) return;
    try {
      const out = target.archived ? await model.ops.threadUnarchive([target.id], { descendants: false }) : await model.ops.threadArchive([target.id], { descendants: false });
      if (!current()) { model.threadQuickActionDrop(target.owner as object, target.id, token); return; }
      if (!out.ok) { model.threadQuickActionFinish(target.owner as object, target.id, token, { kind: "failed", error: out.error.message }); return; }
      const refreshed = await model.ops.threadGet(target.id);
      if (!current()) { model.threadQuickActionDrop(target.owner as object, target.id, token); return; }
      if (!refreshed.ok || refreshed.value.thread_id !== target.id || (refreshed.value.archived_at !== undefined) === target.archived) {
        model.threadQuickActionFinish(target.owner as object, target.id, token, { kind: "failed", error: model.t.value("thread.quickReadbackFailed") });
        return;
      }
      await model.data.refreshThreadList();
      await model.org.read();
      if (!current()) { model.threadQuickActionDrop(target.owner as object, target.id, token); return; }
      const published = liveRow();
      if (!published || (published.archived_at !== undefined) === target.archived) {
        model.threadQuickActionFinish(target.owner as object, target.id, token, { kind: "failed", error: model.t.value("thread.quickReadbackFailed") });
        return;
      }
      model.threadQuickActionFinish(target.owner as object, target.id, token, { kind: "done" });
    } catch (error) {
      const message = error instanceof Error ? error.message : model.t.value("thread.quickReadbackFailed");
      if (current()) model.threadQuickActionFinish(target.owner as object, target.id, token, { kind: "failed", error: message });
      else model.threadQuickActionDrop(target.owner as object, target.id, token);
    }
  };

  const disabled = status !== undefined || !current();
  return <span data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface} data-quick-action-state={status?.kind ?? "idle"}>
    <Button disabled={disabled} aria-busy={status?.kind === "running"} onClick={run}>{row.archived_at !== undefined ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button>
    {status?.kind === "failed" && status.error ? <Notice tone="bad">{status.error}</Notice> : null}
  </span>;
}
