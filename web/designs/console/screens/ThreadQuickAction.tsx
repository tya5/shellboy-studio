
import { formatRoute, managementStop, type AppModel, type Route } from "../../../ui-core/src";
import { Button, Notice } from "../system/components";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ThreadSummary } from "../../../data/src";

type Target = { id: string; archived: boolean; route: Route; owner: AppModel["data"]["owner"]["value"] };

/** One row-qualified archive action shared by sidebar and the Threads list. */
export function ThreadQuickAction({ model, row, surface }: { model: AppModel; row: ThreadSummary; surface: "sidebar" | "list" }) {
  model.quickActionEpoch.value;
  const route = model.route.value;
  const owner = model.data.owner.value;
  const ownerInstanceId = owner.state === "connected" ? owner.info.instance_id : undefined;
  const unresolvedStopKey = ownerInstanceId ? `${ownerInstanceId}:${row.thread_id}:stop` : undefined;
  const unresolvedStop = unresolvedStopKey ? model.managementUnconfirmedRetry.value.get(unresolvedStopKey)?.action === "stop" : false;
  const status = model.threadQuickActionStatus(owner as object, row.thread_id);
  const [stopState, setStopState] = useState<"idle" | "running" | "accepted" | "failed" | "unknown">("idle");
  const mounted = useRef(true);
  const stopTargetRef = useRef<{ id: string; route: Route; owner: Target["owner"] }>();
  useEffect(() => () => { mounted.current = false; }, []);
  const archived = status?.kind === "verified" ? status.archived! : row.archived_at !== undefined;
  const target: Target = { id: row.thread_id, archived, route, owner };
  const liveRow = () => (surface === "sidebar" ? model.data.threadList.peek().items : model.org.shown()).find((item) => item.thread_id === target.id);
  const ownerRouteCurrent = () => model.route.peek() === target.route && model.route.peek().view === target.route.view && model.data.owner.peek() === target.owner;
  const renderedCurrent = () => {
    const live = liveRow();
    return ownerRouteCurrent() && live !== undefined && (status?.kind === "verified" || (live.archived_at !== undefined) === (row.archived_at !== undefined));
  };
  const publish = async () => { try { await model.data.refreshThreadList(); await model.org.read(); } catch { /* Exact readback remains authoritative. */ } };

  const stop = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!mounted.current || unresolvedStop || !renderedCurrent() || stopState === "running") return;
    stopTargetRef.current = { id: target.id, route: target.route, owner: target.owner };
    const token = model.threadQuickActionAdmit(owner as object, target.id);
    if (!token) return;
    setStopState("running");
    let keepReservation = false;
    try {
      const current = () => mounted.current && renderedCurrent();
      const result = await managementStop(model.ops, target.id, undefined, current);
      if (!current()) return;
      if (result.kind !== "sent") { setStopState("failed"); return; }
      if (!current()) return;
      if (result.outcome.ok) setStopState("accepted");
      else if (result.outcome.error.kind === "unconfirmed") {
        keepReservation = true;
        const instanceId = owner.state === "connected" ? owner.info.instance_id : undefined;
        const operationId = result.outcome.error.operationId;
        if (instanceId) {
          const key = `${instanceId}:${target.id}`;
          if (!model.managementUnconfirmedRetry.peek().has(key)) model.managementUnconfirmedRetry.value = new Map(model.managementUnconfirmedRetry.peek()).set(key, { threadId: target.id, runId: result.runId, turnId: result.turnId, operationId, ownerInstanceId: instanceId, action: "stop" });
        }
        setStopState("unknown");
      } else setStopState("failed");
    } finally {
      if (!current()) setStopState("idle");
      if (!keepReservation) model.threadQuickActionDrop(owner as object, target.id, token);
    }
  };

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
      if (!renderedCurrent()) { model.threadQuickActionDrop(owner as object, target.id, token); return; }
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
    <Button data-thread-quick-stop="" variant="stop" disabled={unresolvedStop || stopState === "running" || !renderedCurrent()} onClick={stop}>{model.t.value("action.stop")}</Button>
    {stopTargetRef.current?.id === target.id && stopTargetRef.current.owner === owner && stopTargetRef.current.route === route && stopState === "accepted" ? <Notice>{model.t.value("action.stopAccepted")}</Notice> : null}
    {stopTargetRef.current?.id === target.id && stopTargetRef.current.owner === owner && stopTargetRef.current.route === route && stopState === "failed" ? <Notice tone="bad">{model.t.value("action.stopRefused")}</Notice> : null}
    {stopTargetRef.current?.id === target.id && stopTargetRef.current.owner === owner && stopTargetRef.current.route === route && stopState === "unknown" ? <Notice tone="wait">{model.t.value("action.stopUnknown")}</Notice> : null}
  </span>;
}
