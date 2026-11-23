import { SIDEBAR_PIN_TAG } from "../../../../ui-core/src/sidebar";
import type { ThreadSummary } from "../../../../data/src";
import { isThreadRecovery, type AppModel, type StatusKey } from "../../../../ui-core/src";
import type { MenuEntry } from "./Menu";

export function threadMenuEntries(model: AppModel, row: ThreadSummary, status: StatusKey | undefined, onDelete: (row: ThreadSummary) => void, tags?: { onEditTags: () => void }): MenuEntry[] {
  const archived = row.archived_at !== undefined;
  const report = async (action: string, work: () => Promise<{ ok: boolean; error?: { message: string } }>, announceSuccess = true) => {
    model.actionError.value = undefined;
    const result = await work();
    model.actionError.value = result.ok ? (announceSuccess ? { kind: "success", text: model.t.value("action.succeeded", { action }) } : undefined) : { kind: "error", text: result.error?.message ?? model.t.value("action.failed", { action }) };
  };
  const pinned = row.tags?.includes(SIDEBAR_PIN_TAG) ?? false;
  const pinLabel = model.t.value(pinned ? "sidebar.unpin" : "sidebar.pin");
  const taggedEntries: MenuEntry[] = tags ? [
      { key: "pin", icon: "thread.pinned" as const, label: pinLabel, onSelect: () => void report(pinLabel, async () => {
        const result = await model.ops.threadTag({ thread_ids: [row.thread_id], ...(pinned ? { remove: [SIDEBAR_PIN_TAG] } : { add: [SIDEBAR_PIN_TAG] }) });
        return result.ok && result.value.not_found.includes(row.thread_id) ? { ok: false } : result;
      }, false) },
      { key: "edit-tags", icon: "action.editTags", label: model.t.value("sidebar.editTags"), onSelect: tags.onEditTags },
    ] : [];
  const entries: MenuEntry[] = [
    ...taggedEntries,
    { key: "archive", icon: archived ? "action.unarchive" : "action.archive", label: archived ? model.t.value("org.unarchive") : model.t.value("action.archive"), onSelect: () => void report(archived ? model.t.value("org.unarchive") : model.t.value("action.archive"), () => archived ? model.ops.threadUnarchive([row.thread_id], { descendants: false }) : model.ops.threadArchive([row.thread_id], { descendants: false })) },
    { key: "stop", icon: "action.stop", label: model.t.value("action.stop"), disabled: status !== "running", onSelect: () => void report(model.t.value("action.stop"), async () => { const details = await model.ops.threadGet(row.thread_id); if (!details.ok || !details.value.run_id) return { ok: false, error: { message: model.t.value("action.stopRefused") } }; return model.ops.runStop(details.value.run_id); }) },
    { key: "retry", icon: "action.retry", label: model.t.value("action.retry"), disabled: !isThreadRecovery(status, row.activity), onSelect: () => void report(model.t.value("action.retry"), async () => { const details = await model.ops.threadGet(row.thread_id); if (!details.ok || !details.value.run_id) return { ok: false, error: { message: model.t.value("action.retry") } }; return model.ops.runRetry(details.value.run_id); }) },
    { key: "actions-separator", separator: true },
    { key: "delete", icon: "action.delete", label: model.t.value("thread.deletePreview"), destructive: true, onSelect: () => { model.actionError.value = undefined; onDelete(row); } },
  ];
  return entries;
}
