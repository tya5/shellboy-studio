import type { HistoryItem } from '../../data/src/protocol';

/** Capture repeated read context once per selected cut, retaining every public row field. */
export function captureHistoryWindowRows(rows: readonly HistoryItem[]): readonly HistoryItem[] {
  const contexts = new Map<string, NonNullable<HistoryItem['provenance']>>();
  return Object.freeze(rows.map(row => {
    if (!row.provenance) return row;
    const key = JSON.stringify(row.provenance);
    let provenance = contexts.get(key);
    if (!provenance) {
      provenance = Object.freeze(structuredClone(row.provenance));
      contexts.set(key, provenance);
    }
    return Object.freeze({ ...row, provenance });
  }));
}
