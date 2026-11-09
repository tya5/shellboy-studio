/** Owner-recorded identity, never inferred from notification text or a self-asserted label. */
export type SenderFact =
  | { kind: 'human' }
  | { kind: 'external_cli'; label?: string }
  | { kind: 'model'; threadId: string; label?: string }
  | { kind: 'unknown_model'; label?: string }
  | { kind: 'unknown'; label?: string; sourceKind?: string };
export function senderFact(value: unknown): SenderFact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'unknown' };
  const v = value as Record<string, unknown>;
  const label = typeof v.label === 'string' ? v.label : undefined;
  if (v.kind === 'human') return { kind: 'human' };
  if (v.kind === 'external_cli') return { kind: 'external_cli', ...(label !== undefined ? { label } : {}) };
  if (v.kind === 'model') return typeof v.thread_id === 'string' && v.thread_id.trim() !== ''
    ? { kind: 'model', threadId: v.thread_id, ...(label !== undefined ? { label } : {}) }
    : { kind: 'unknown_model', ...(label !== undefined ? { label } : {}) };
  return { kind: 'unknown', ...(label !== undefined ? { label } : {}), ...(typeof v.kind === 'string' ? { sourceKind: v.kind } : {}) };
}
