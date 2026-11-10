/** Measure only the supplied loaded DOM, never the full Thread or guessed identities. */
export function measureAcceptedRows(root: HTMLElement, rows: readonly { node_id?: string; selection?: { ordinal?: number } }[]): [number, number][] {
  const parent = root.querySelector<HTMLElement>('.conversation-items');
  if (!parent) return [];
  const ordinals = new Map<string, number>();
  for (const row of rows) {
    const ordinal = row.selection?.ordinal;
    if (!row.node_id || ordinal === undefined || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinals.has(row.node_id)) return [];
    ordinals.set(row.node_id, ordinal);
  }
  const nodes = [...parent.children] as HTMLElement[];
  const keys = new Map<string, string>();
  for (const el of parent.querySelectorAll<HTMLElement>("[data-item-key]")) {
    if (el.closest(".live-tail, [data-live-overlay]")) continue;
    const key = el.dataset.itemKey;
    if (!key) continue;
    if (keys.has(key) || !el.dataset.node) return [];
    keys.set(key, el.dataset.node);
  }
  const sums = new Map<number, number>();
  const measuredHeight = (el: HTMLElement): number | undefined => {
    const value = el.getBoundingClientRect().height;
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const add = (node: string, px: number): boolean => {
    const ordinal = ordinals.get(node);
    if (ordinal === undefined) return false;
    sums.set(ordinal, (sums.get(ordinal) ?? 0) + px);
    return true;
  };
  for (const outer of nodes) {
    let el = outer;
    if (!el.hasAttribute("data-work-group") && el.matches(".conversation-row.steps")) {
      if (el.children.length !== 1 || !el.firstElementChild?.hasAttribute("data-work-group")) return [];
      const inner = el.firstElementChild as HTMLElement;
      const outside = measuredHeight(el), inside = measuredHeight(inner);
      if (outside === undefined || inside === undefined || Math.abs(outside - inside) > 1e-6) return [];
      el = inner;
    }
    if (el.matches(".live-tail, [data-live-overlay]")) continue;
    if (el.hasAttribute("data-work-group")) {
      let members: unknown;
      try { members = JSON.parse(el.dataset.headingMemberKeys ?? 'null'); } catch { return []; }
      if (!Array.isArray(members) || !members.length || members.some(key => typeof key !== 'string') || new Set(members).size !== members.length) return [];
      const memberKeys = members as string[];
      const memberNodes = memberKeys.map(key => keys.get(key));
      if (memberNodes.some(node => node === undefined || !ordinals.has(node))) return [];
      const actual = [...el.querySelectorAll<HTMLElement>('[data-item-key]')].filter(item => !item.closest('.live-tail, [data-live-overlay]'));
      if (actual.length !== memberKeys.length || actual.some(item => item.closest('[data-work-group]') !== el || !memberKeys.includes(item.dataset.itemKey!))) return [];
      const total = measuredHeight(el);
      if (total === undefined || el.tagName !== 'DETAILS') return [];
      // Closed descendants retain provenance but contribute no visible geometry.
      if (!el.hasAttribute('open')) {
        for (const node of memberNodes) if (!add(node!, 0)) return [];
        if (!add(memberNodes[0]!, total)) return [];
        continue;
      }
      const heading = el.querySelector<HTMLElement>(':scope > summary[data-work-heading]');
      const list = el.querySelector<HTMLElement>(':scope > .step-group-list');
      if (!heading || !list || el.children.length !== 2) return [];
      const headingHeight = measuredHeight(heading);
      if (headingHeight === undefined || !add(memberNodes[0]!, headingHeight)) return [];
      let accounted = headingHeight;
      const seen = new Set<string>();
      for (const child of list.children as HTMLCollectionOf<HTMLElement>) {
        const px = measuredHeight(child);
        if (px === undefined) return [];
        if (child.matches('.live-tail, [data-live-overlay]')) {
          // Nonzero live geometry has no saved ordinal: do not silently lose it.
          if (px !== 0) return [];
          continue;
        }
        const key = child.dataset.itemKey;
        if (!key || child.dataset.workItemKey !== key || !memberKeys.includes(key) || seen.has(key) || child.dataset.node !== keys.get(key)) return [];
        seen.add(key);
        if (!add(child.dataset.node!, px)) return [];
        accounted += px;
      }
      if (seen.size !== memberKeys.length || Math.abs(accounted - total) > 1e-6) return [];
      continue;
    }
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
