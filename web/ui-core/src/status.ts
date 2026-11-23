import { isActiveThreadActivity } from "../../data/src";

import type { Translate } from "./i18n";

/** Thread marks group owner activities by what needs attention. Awaiting is supplied by the pending adapter. */
export type StatusKey = "running" | "awaiting" | "error" | "waiting" | "idle";
export type ShellStatusKey = "running" | "completed" | "failed" | "stopped";
type ActivityStatus = Exclude<StatusKey, "error"> | ShellStatusKey | "recovery";

export const STATUS_KEYS: readonly StatusKey[] = ["awaiting", "error", "running", "waiting", "idle"];
export { isActiveThreadActivity } from "../../data/src";

const BY_ACTIVITY: Record<string, ActivityStatus> = {
  idle: "idle",
  sending: "running",
  reflecting: "running",
  preparing: "running",
  awaiting_model: "running",
  retrying: "running",
  receiving: "running",
  tools: "running",
  running: "running",
  background: "running",
  continuing: "running",
  stopping: "running",
  // The Run is inside its own shellboy wait (reply, shell end, Thread settling, or time).
  waiting: "waiting",
  recovery: "recovery",
  failed: "failed",
  stopped: "stopped",
  completed: "completed",
};

/** The active conversation footer uses unmerged activity wording and artwork. */
export function activityStatus(activity: string | undefined): ActivityStatus | undefined {
  return activity !== undefined && Object.hasOwn(BY_ACTIVITY, activity) ? BY_ACTIVITY[activity] : undefined;
}

export function statusOfActivity(activity: string | undefined): StatusKey | undefined {
  if (isActiveThreadActivity(activity)) return "running";
  const status = activityStatus(activity);
  switch (status) {
    case "recovery": case "failed": return "error";
    case "completed": case "stopped": return "idle";
    default: return status;
  }
}

/** Retry is an owner recovery fact, not a capability implied by an error mark. */
export function isThreadRecovery(status: StatusKey | undefined, activity: string | undefined): boolean {
  return status === "error" && activityStatus(activity) === "recovery";
}

export const statusLabel = (t: Translate, status: StatusKey): string => t(status === "idle" ? "status.quiet" : `status.${status}`);
export const activityStatusLabel = (t: Translate, status: Exclude<ActivityStatus, "idle">): string => t(`status.${status}`);

/** Saved native shell state plus exit code. Exit code 0 is the only exit that counts as completed. */
export function statusOfShell(state: string | undefined, exitCode: number | null | undefined): ShellStatusKey | undefined {
  switch (state) {
    case "starting":
    case "running":
    case "stopping":
      return "running";
    case "exited":
      return exitCode === 0 ? "completed" : "failed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return undefined;
  }
}
