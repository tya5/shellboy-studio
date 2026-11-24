/** The sole owner of Thread activity-to-Thread-status meanings. */
export const ACTIVITY_STATUS = {
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
  recovery: "error",
  failed: "error",
  stopped: "idle",
  completed: "idle",
} as const;

export type ActivityStatus = (typeof ACTIVITY_STATUS)[keyof typeof ACTIVITY_STATUS];
export function activityStatus(activity: string | undefined): ActivityStatus | undefined {
  return activity !== undefined && Object.hasOwn(ACTIVITY_STATUS, activity)
    ? ACTIVITY_STATUS[activity as keyof typeof ACTIVITY_STATUS]
    : undefined;
}

export function isActiveThreadActivity(activity: string | undefined): boolean {
  const status = activityStatus(activity);
  return status !== undefined && status !== "idle";
}
