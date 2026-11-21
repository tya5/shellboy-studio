export type ThreadDeletePreview = {
  selection: { thread_count: number | undefined; descendant_thread_count: number | undefined; surviving_descendant_thread_count: number | undefined };
  blockers: { live_run_count: number | undefined; stopping_run_count: number | undefined; truncated: boolean | undefined };
  deletable_now: boolean | undefined;
  preview_marker: { thread_count: number; ids_hash: string } | undefined;
  preview_marker_unavailable_reason: string | undefined;
};
