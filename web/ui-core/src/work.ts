import type { Page, ShellEntry, WorkItem } from "../../data/src";

export interface WorkRow {
  id: string;
  state: string;
  label: string;
  startedAt?: string;
}
export interface WorkRegions {
  running: WorkRow[];
  pending: WorkRow[];
  partial: boolean;
}

export function toolLabel(description: string | undefined, command: string | undefined, fallback = ""): string {
  return description?.trim() || command?.trim() || fallback;
}

/** Only facts on this bounded page. A continuation means counts are lower bounds. */
export function workRegions(page: Page<WorkItem> | undefined, runId: string | undefined, shells: ReadonlyMap<string, ShellEntry>): WorkRegions {
  const running: WorkRow[] = [];
  const pending: WorkRow[] = [];
  for (const item of page?.items ?? []) {
    if (item.kind === "shell" && runId && item.run_id === runId && item.execution_id && ["starting", "running", "stopping"].includes(item.state)) {
      const shell = shells.get(item.execution_id);
      running.push({ id: item.execution_id, state: item.state, label: toolLabel(typeof shell?.description === "string" ? shell.description : undefined, shell?.command_excerpt, item.execution_id), ...((item.started_at || shell?.started_at) ? { startedAt: item.started_at || shell?.started_at } : {}) });
    } else if (item.kind === "message" && item.message_id && ["accepted", "held"].includes(item.state)) {
      pending.push({ id: item.message_id, state: item.state, label: item.excerpt?.replace(/\s+/g, " ").trim().slice(0, 512) || "" });
    }
  }
  return { running, pending, partial: page?.next_cursor !== undefined };
}
