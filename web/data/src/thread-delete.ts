export type ThreadDeletePreview = {
  selection: { thread_count: number | undefined; descendant_thread_count: number | undefined; surviving_descendant_thread_count: number | undefined };
  blockers: { live_run_count: number | undefined; stopping_run_count: number | undefined; truncated: boolean | undefined };
  deletable_now: boolean | undefined;
  preview_marker: { thread_count: number; ids_hash: string } | undefined;
  preview_marker_unavailable_reason: string | undefined;
};

export const DELETE_SET_LIMIT = 256;
export type DeleteMarker = NonNullable<ThreadDeletePreview["preview_marker"]>;
export type DeleteSetTarget = {
  thread_id: string;
  live_run_count: number;
  stopping_run_count: number;
  runs: { id: string; state: "live" | "stopping" }[];
  runs_more: boolean;
  scheduled_execution_ids: string[];
  scheduled_execution_count: number;
  scheduled_executions_more: boolean;
};
export type ThreadDeleteSetPreview = {
  thread_ids: string[];
  targets: DeleteSetTarget[];
  preview_marker: DeleteMarker;
  deletable_now: boolean;
};
