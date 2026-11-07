// Status meaning, shared by every design. A design may restyle a state, not merge or rename one.
// The owner's `activity` word is the source; nothing here recomputes lifecycle.

/**
 * - running: work is in progress
 * - awaiting: a person must answer (only from the pending adapter, never from `activity`)
 * - waiting: paused on something other than a person (a child, a timer)
 * - recovery: stopped on a failure, can be retried
 * - failed, stopped, completed: ended
 * - idle: no Run yet, ready for input
 */
export type StatusKey = "running" | "awaiting" | "waiting" | "recovery" | "failed" | "stopped" | "completed" | "idle";

export const STATUS_KEYS: readonly StatusKey[] = ["awaiting", "recovery", "failed", "running", "waiting", "stopped", "completed", "idle"];

const BY_ACTIVITY: Record<string, StatusKey> = {
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
  waiting: "waiting",
  recovery: "recovery",
  failed: "failed",
  stopped: "stopped",
  completed: "completed",
};

export function statusOfActivity(activity: string | undefined): StatusKey | undefined {
  return activity === undefined ? undefined : BY_ACTIVITY[activity];
}

/** Saved native shell state plus exit code. Exit code 0 is the only exit that counts as completed. */
export function statusOfShell(state: string | undefined, exitCode: number | null | undefined): StatusKey | undefined {
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
