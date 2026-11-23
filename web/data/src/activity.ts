/** Thread phases that represent work currently in progress, owned by the data contract. */
const ACTIVE_THREAD_ACTIVITIES = new Set([
  "awaiting_model", "background", "continuing", "preparing", "receiving", "reflecting",
  "retrying", "running", "sending", "stopping", "tools",
]);

export function isActiveThreadActivity(activity: string | undefined): boolean {
  return activity !== undefined && ACTIVE_THREAD_ACTIVITIES.has(activity);
}
