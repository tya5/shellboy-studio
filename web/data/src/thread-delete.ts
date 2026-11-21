export type ThreadDeletePreview = {
  deletable_now: boolean | undefined;
  preview_marker: { thread_count: number; ids_hash: string } | undefined;
  selection: { thread_count: number | undefined; descendant_thread_count: number | undefined; surviving_descendant_thread_count: number | undefined } | undefined;
  blockers: Record<string, unknown> | undefined;
};
