import type { ThreadSummary } from "../../../../data/src";
import type { AppModel, StatusKey } from "../../../../ui-core/src";
import type { MenuEntry } from "./Menu";

export type RowFocusReturn = { returnFocusTo: HTMLElement | null; resolveFocusFallback: () => HTMLElement | null };
export type ThreadDeleteRequest = { target: ThreadSummary } & RowFocusReturn;
export function captureRowFocusReturn(opener: HTMLElement | null, placementAnchor: HTMLElement | null = null): RowFocusReturn {
  const row = opener?.closest<HTMLElement>(".tree-item, .srow") ?? placementAnchor?.closest<HTMLElement>(".tree-item, .srow");
  const nearby = [row?.nextElementSibling, row?.previousElementSibling].filter((node): node is HTMLElement => node instanceof HTMLElement);
  return {
    returnFocusTo: opener,
    resolveFocusFallback: () => nearby.map((element) => element.querySelector<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')).find((element) => element?.isConnected) ?? null,
  };
}

export function threadMenuEntries(model: AppModel, row: ThreadSummary, status: StatusKey | undefined, onDelete: (row: ThreadSummary, opener: HTMLElement | null, placementAnchor: HTMLElement | null) => void): MenuEntry[] {
  const archived = row.archived_at !== undefined;
  const report = async (action: string, work: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    model.actionError.value = undefined;
    const result = await work();
    model.actionError.value = result.ok ? { kind: "success", text: model.t.value("action.succeeded", { action }) } : { kind: "error", text: result.error?.message ?? model.t.value("action.failed", { action }) };
  };
  return [
    { key: "archive", icon: archived ? "action.unarchive" : "action.archive", label: archived ? model.t.value("org.unarchive") : model.t.value("action.archive"), onSelect: () => void report(archived ? model.t.value("org.unarchive") : model.t.value("action.archive"), () => archived ? model.ops.threadUnarchive([row.thread_id], { descendants: false }) : model.ops.threadArchive([row.thread_id], { descendants: false })) },
    { key: "stop", icon: "action.stop", label: model.t.value("action.stop"), disabled: status !== "running", onSelect: () => void report(model.t.value("action.stop"), async () => { const details = await model.ops.threadGet(row.thread_id); if (!details.ok || !details.value.run_id) return { ok: false, error: { message: model.t.value("action.stopRefused") } }; return model.ops.runStop(details.value.run_id); }) },
    { key: "retry", icon: "action.retry", label: model.t.value("action.retry"), disabled: status !== "recovery", onSelect: () => void report(model.t.value("action.retry"), async () => { const details = await model.ops.threadGet(row.thread_id); if (!details.ok || !details.value.run_id) return { ok: false, error: { message: model.t.value("action.retry") } }; return model.ops.runRetry(details.value.run_id); }) },
    { key: "actions-separator", separator: true },
    { key: "delete", icon: "action.delete", label: model.t.value("thread.deletePreview"), destructive: true, onSelect: (opener, placementAnchor) => { model.actionError.value = undefined; onDelete(row, opener, placementAnchor); } },
  ];
}
