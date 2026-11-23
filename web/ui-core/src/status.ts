import { ACTIVITY_STATUS, activityStatus, type ActivityStatus } from "../../data/src";
export { activityStatus } from "../../data/src";

import type { Translate } from "./i18n";

/** Thread marks group owner activities by what needs attention. Awaiting is supplied by the pending adapter. */
export type StatusKey = "running" | "awaiting" | "error" | "waiting" | "idle";
export type ShellStatusKey = "running" | "completed" | "failed" | "stopped";

export const STATUS_KEYS: readonly StatusKey[] = ["awaiting", "error", "running", "waiting", "idle"];


export const statusOfActivity = activityStatus;

/** Retry is an owner recovery fact, not a capability implied by an error mark. */
export function isThreadRecovery(status: StatusKey | undefined, activity: string | undefined): boolean {
  return status === "error" && activity === "recovery";
}

export const statusLabel = (t: Translate, status: StatusKey): string => t(status === "idle" ? "status.quiet" : `status.${status}`);
export const activityStatusLabel = (t: Translate, status: ActivityStatus | StatusKey | ShellStatusKey): string => t(`status.${status === "idle" ? "quiet" : status}`);

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
