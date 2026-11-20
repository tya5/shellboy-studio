
import { formatRoute, type AppModel, type Route } from "../../../ui-core/src";
import { Button, Notice } from "../system/components";
import type { ThreadSummary } from "../../../data/src";

type Target = { id: string; archived: boolean; route: Route; owner: AppModel["data"]["owner"]["value"] };

/** One row-qualified archive action shared by sidebar and the Threads list. */
export function ThreadQuickAction({ model, row, surface }: { model: AppModel; row: ThreadSummary; surface: "sidebar" | "list" }) {
  model.quickActionEpoch.value;
  const route = model.route.value;
  const owner = model.data.owner.value;
  const status = model.threadQuickActionStatus(owner as object, row.thread_id);
  const archived = status?.kind === "verified" ? status.archived! : row.archived_at !== undefined;
  const target: Target = { id: row.thread_id, archived, route, owner };
  const liveRow = () => (surface === "sidebar" ? model.data.threadList.peek().items : model.org.shown()).find((item) => item.thread_id === target.id);
  const ownerRouteCurrent = () => model.route.peek() === target.route && model.route.peek().view === target.route.view && model.data.owner.peek() === target.owner;
  const renderedCurrent = () => {
    const live = liveRow();
    return ownerRouteCurrent() && live !== undefined && (status?.kind === "verified" || (live.archived_at !== undefined) === (row.archived_at !== undefined));
  };
  const publish = async () => { try { await model.data.refreshThreadList(); await model.org.read(); } catch { /* Exact readback remains authoritative. */ } };

  const run = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!renderedCurrent()) return;
    const token = model.threadQuickActionAdmit(owner as object, target.id);
    if (!token) return;
    try {
      const preflight = await model.ops.threadGet(target.id);
      if (!ownerRouteCurrent()) { model.threadQuickActionDrop(owner as object, target.id, token); return; }
      if (!preflight.ok || preflight.value.thread_id !== target.id || (preflight.value.archived_at !== undefined) !== target.archived) {
        model.threadQuickActionFinish(owner as object, target.id, token, { kind: "failed", error: model.t.value("thread.quickReadbackFailed") });
        await publish();
        return;
      }
      const out = target.archived ? await model.ops.threadUnarchive([target.id], { descendants: false }) : await model.ops.threadArchive([target.id], { descendants: false });
      if (!ownerRouteCurrent()) { model.threadQuickActionDrop(owner as object, target.id, token); return; }
      if (!out.ok) {
        model.threadQuickActionFinish(owner as object, target.id, token, { kind: "failed", error: out.error.message });
        await publish();
        return;
      }
      const refreshed = await model.ops.threadGet(target.id);
      if (!ownerRouteCurrent()) { model.threadQuickActionDrop(owner as object, target.id, token); return; }
      if (!refreshed.ok || refreshed.value.thread_id !== target.id || (refreshed.value.archived_at !== undefined) === target.archived) {
        model.threadQuickActionFinish(owner as object, target.id, token, { kind: "failed", error: model.t.value("thread.quickReadbackFailed") });
        await publish();
        return;
      }
      model.threadQuickActionFinish(owner as object, target.id, token, { kind: "verified", archived: !target.archived });
      await publish();
    } catch (error) {
      const message = error instanceof Error ? error.message : model.t.value("thread.quickReadbackFailed");
      if (ownerRouteCurrent()) model.threadQuickActionFinish(owner as object, target.id, token, { kind: "failed", error: message });
      else model.threadQuickActionDrop(owner as object, target.id, token);
    } finally {
      if (model.threadQuickActionStatus(owner as object, target.id)?.kind === "running") model.threadQuickActionDrop(owner as object, target.id, token);
    }
  };
  const disabled = status?.kind === "running" || !renderedCurrent();
  return <span data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface} data-quick-action-state={status?.kind ?? "idle"}>
    <Button disabled={disabled} aria-busy={status?.kind === "running"} onClick={run}>{archived ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button>
    {status?.kind === "failed" ? <>
      {status.error ? <Notice tone="bad">{status.error}</Notice> : null}
      <a class="btn link" href={formatRoute({ view: "thread-management", threadId: target.id })}>{model.t.value("view.threads")}</a>
    </> : null}
  </span>;
}
