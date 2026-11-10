/** Measure only the supplied loaded DOM, never the full Thread or guessed identities. */
export function measureAcceptedRows(root: HTMLElement, rows: readonly { node_id: string; selection: { ordinal: number } }[]): [number, number][] {
  const parent = root.querySelector<HTMLElement>('.conversation-items');
  if (!parent) return [];
  const ordinals = new Map(rows.map(row => [row.node_id, row.selection.ordinal]));
  const nodes = [...parent.children] as HTMLElement[];
  const keys = new Map<string, string>();
  for (const el of nodes) {
    const key = el.dataset.itemKey;
    if (!key) continue;
    if (keys.has(key) || !el.dataset.node) return [];
    keys.set(key, el.dataset.node);
  }
  const sums = new Map<number, number>();
  for (const el of nodes) {
    let node = el.dataset.node;
    if (el.dataset.headingAnchorKey !== undefined) {
      let members: unknown;
      try { members = JSON.parse(el.dataset.headingMemberKeys ?? 'null'); } catch { return []; }
      if (!Array.isArray(members) || typeof members[0] !== 'string') return [];
      node = keys.get(members[0]);
    }
    const ordinal = node === undefined ? undefined : ordinals.get(node);
    if (ordinal === undefined) return [];
    const height = el.getBoundingClientRect().height;
    if (!Number.isFinite(height) || height < 0) return [];
    sums.set(ordinal, (sums.get(ordinal) ?? 0) + height);
  }
  return [...sums].sort(([a], [b]) => a - b);
}
