import { formatRoute, type AppModel } from "../../../ui-core/src";
import { Button, Notice } from "../system/components";
import { useState } from "preact/hooks";
import type { ThreadSummary } from "../../../data/src";
import type { StatusKey } from "../../../ui-core/src/status";

type Action = "archive" | "stop" | "retry";

/** Row actions follow the projected owner status; Core remains mutation authority. */
export function ThreadQuickAction({ model, row, status, surface }: { model: AppModel; row: ThreadSummary; status: StatusKey | undefined; surface: "sidebar" | "list" }) {
  const route = model.route.value;
  const [pending, setPending] = useState<Action>();
  const [result, setResult] = useState<string>();
  const archived = row.archived_at !== undefined;
  const publish = async () => { try { await model.data.refreshThreadList(); await model.org.read(); } catch { /* Core result remains authoritative. */ } };
  const runAction = async (action: Action, work: () => Promise<void>) => {
    if (pending) return;
    setPending(action); setResult(undefined);
    try { await work(); setResult(action === "retry" ? model.t.value("action.retryAccepted") : model.t.value(action === "stop" ? "action.stopAccepted" : "action.archive")); }
    catch (error) { setResult(error instanceof Error ? error.message : model.t.value("action.refused")); }
    finally { setPending(undefined); }
  };
  const archive = () => void runAction("archive", async () => {
    const out = archived ? await model.ops.threadUnarchive([row.thread_id], { descendants: false }) : await model.ops.threadArchive([row.thread_id], { descendants: false });
    if (!out.ok) throw new Error(out.error.message);
    await publish();
  });
  const stop = () => void runAction("stop", async () => {
    const details = await model.ops.threadGet(row.thread_id);
    if (!details.ok || details.value.thread_id !== row.thread_id || !details.value.run_id) throw new Error(model.t.value("action.stopRefused"));
    const out = await model.ops.runStop(details.value.run_id);
    if (!out.ok) throw new Error(out.error.message);
  });
  const retry = () => void runAction("retry", async () => { await model.retry(row.thread_id); });
  const disabled = pending !== undefined;
  return <span data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface}>
    {status === "recovery" ? <Button data-thread-quick-retry="" variant="warn" disabled={disabled} onClick={retry}>{model.t.value("action.retry")}</Button> : null}
    {status === "running" ? <Button data-thread-quick-stop="" variant="stop" disabled={disabled} onClick={stop}>{model.t.value("action.stop")}</Button> : null}
    {status === "completed" || status === "stopped" || status === "failed" ? <Button disabled={disabled} onClick={archive}>{archived ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button> : null}
    {result ? <Notice>{result}</Notice> : null}
    <a class="btn link" href={formatRoute({ view: "thread-management", threadId: row.thread_id })}>{model.t.value("view.threads")}</a>
  </span>;
}
