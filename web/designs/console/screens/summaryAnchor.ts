/** Geometry input only: S owns membership, scope and transaction qualification. */
export interface SummaryGeometry {
  readonly kind: 'inside' | 'below';
  readonly summaryNodeId: string;
  readonly source: { readonly nodeId: string; readonly offset: number };
}
export function measureSummaryTransition(box: HTMLElement, observation: SummaryGeometry, current: () => boolean): number | undefined {
  if (!current() || !Number.isFinite(observation.source.offset)) return;
  const target = observation.kind === 'inside' ? observation.summaryNodeId : observation.source.nodeId;
  const elements = [...box.querySelectorAll<HTMLElement>('.conversation-items [data-node]')]
    .filter(element => element.dataset.node === target && !element.closest('[data-live-overlay], .live-tail'));
  if (elements.length !== 1) return;
  const element = elements[0]!;
  if (element.closest('[hidden]')) return;
  for (let parent = element.parentElement; parent && parent !== box; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) return;
  const rect = element.getBoundingClientRect(), viewport = box.getBoundingClientRect();
  if (!current() || !Number.isFinite(rect.top) || !Number.isFinite(viewport.top) || !Number.isFinite(rect.height) || rect.height <= 0) return;
  return rect.top - viewport.top - observation.source.offset;
}
