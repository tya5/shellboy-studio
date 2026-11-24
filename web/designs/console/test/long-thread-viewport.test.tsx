// @vitest-environment happy-dom
import '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { SavedWindowContent } from '../screens/Conversation';
import { ViewportGeometry } from '../screens/viewportGeometry';
import { WindowedScroll } from '../screens/WindowedScroll';
import { publicConversationFixture } from './conversation-fixture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('estimates only loaded unmeasured rows from the mounted sample and replaces by key', () => {
  const g = new ViewportGeometry(['a', 'b', 'c'], 44);
  expect(g.offset(3)).toBe(132);
  expect(g.measure('outside', 200)).toBe(false);
  expect(g.measure('b', 80)).toBe(true);
  expect(g.offset(3)).toBe(240);
  expect(g.measure('a', 40)).toBe(true);
  expect(g.offset(2)).toBe(120);
  expect(g.offset(3)).toBe(180);
  expect(g.measure('a', 40)).toBe(false);
  const next = new ViewportGeometry(['b', 'c'], 44, g);
  expect(next.offset(2)).toBe(160);
});

it.each([20, 4_000])('mounts and observes only the viewport plus overscan for %i messages', async count => {
  const nodes = Array.from({length: count}, (_, i) => ({ node_id: `node-${i}`, kind: 'user' as const, excerpt: `Message ${i}` }));
  const f = await publicConversationFixture({ nodes });
  const win = f.model.longReader.peek()!;
  const observed = new Set<Element>();
  vi.stubGlobal('ResizeObserver', class {
    observe(node: Element) { observed.add(node); }
    unobserve(node: Element) { observed.delete(node); }
    disconnect() { observed.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.min(count, 100) * 40;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.matches('.scroll') ? 160 : 40;
    const top = this.matches('.vspace') ? -(this.closest<HTMLElement>('.scroll')?.scrollTop ?? 0) : 0;
    return { top, bottom: top + height, height } as DOMRect;
  });
  const host = document.createElement('div');
  document.body.append(host);
  try {
    await act(async () => render(<WindowedScroll model={f.model} win={win} live={null} renderRow={() => <div/>}
      renderAcceptedView={snapshot => <SavedWindowContent model={f.model} snapshot={snapshot}/>}/>, host));
    const rows = () => Array.from(host.querySelectorAll('[data-viewport-key]'));
    expect(win.acceptedView.peek().rows).toHaveLength(Math.min(count, 100));
    expect(rows().length).toBeGreaterThanOrEqual(4);
    expect(rows().length).toBeLessThanOrEqual(13);
    expect(rows().every(row => observed.has(row))).toBe(true);
    expect(observed.size).toBe(rows().length + 1);
    expect(host.querySelector(`[data-node="node-${count - 1}"]`)).not.toBeNull();
    const box = host.querySelector<HTMLElement>('.scroll')!;
    const newest = rows().at(-1)!;
    await act(async () => {
      box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -160 }));
      box.scrollTop = 80;
      box.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(newest.isConnected).toBe(false);
    expect(observed.has(newest)).toBe(false);
    expect(rows().length).toBeLessThanOrEqual(13);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
  expect(observed.size).toBe(0);
});

it('mounts only a slice of a single expanded Work group', async () => {
  const nodes = Array.from({length: 80}, (_, i) => ({ node_id: `work-${i}`, kind: 'assistant_response' as const,
    items: [{kind: 'reasoning_unavailable' as const, item_identity: `marker-${i}`}] }));
  const f = await publicConversationFixture({ nodes });
  const win = f.model.longReader.peek()!;
  const observed = new Set<Element>();
  vi.stubGlobal('ResizeObserver', class {
    observe(node: Element) { observed.add(node); }
    unobserve(node: Element) { observed.delete(node); }
    disconnect() { observed.clear(); }
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(160);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.matches('.scroll') ? 160 : 40;
    const top = this.matches('.vspace') ? -(this.closest<HTMLElement>('.scroll')?.scrollTop ?? 0) : 0;
    return { top, bottom: top + height, height } as DOMRect;
  });
  const host = document.createElement('div');
  document.body.append(host);
  try {
    expect(win.acceptedView.peek().displayPlan?.workGroups.map(group => group.memberKeys.length)).toEqual([80]);
    await act(async () => render(<WindowedScroll model={f.model} win={win} live={null} renderRow={() => <div/>}
      renderAcceptedView={snapshot => <SavedWindowContent model={f.model} snapshot={snapshot}/>}/>, host));
    const details = host.querySelector<HTMLDetailsElement>('details[data-work-group]')!;
    expect(details.open).toBe(false);
    expect(host.querySelectorAll('[data-work-item-key]')).toHaveLength(0);
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')); });
    const workRows = [...host.querySelectorAll('[data-work-item-key]')];
    expect(workRows.length).toBeGreaterThanOrEqual(4);
    expect(workRows.length).toBeLessThanOrEqual(13);
    expect(workRows.every(row => observed.has(row))).toBe(true);
    expect(host.querySelectorAll('details[data-work-group]')).toHaveLength(1);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
  expect(observed.size).toBe(0);
});
