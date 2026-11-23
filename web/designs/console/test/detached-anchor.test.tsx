// @vitest-environment happy-dom
import '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { HistoryItem } from '../../../data/src/protocol';
import { settle } from '../../../data/test/harness';
import { publicConversationFixture } from './conversation-fixture';
import { SavedWindowContent } from '../screens/Conversation';
import { WindowedScroll } from '../screens/WindowedScroll';

const rows = (above = 'Before') => [
  { node_id: 'before', kind: 'user', excerpt: above },
  { node_id: 'reading', kind: 'user', excerpt: 'Keep reading here' },
  { node_id: 'after', kind: 'user', excerpt: 'After' },
] as const;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mounted(detachInitially = true, nodes: readonly HistoryItem[] = rows()) {
  const f = await publicConversationFixture({ nodes });
  const win = f.model.longReader.peek()!;
  const host = document.createElement('div');
  document.body.append(host);
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.scroll')) return rect(0, 400);
    const box = this.closest<HTMLElement>('.scroll');
    const scrollTop = box?.scrollTop ?? 0;
    const beforeHeight = box?.textContent?.includes('Grown before') ? 180 : 100;
    if (this.matches('.vspace')) return rect(-scrollTop, 600);
    if (this.dataset.node === 'before') return rect(-scrollTop, beforeHeight);
    const reading = box?.querySelector('[data-item-key][data-node="reading"]');
    const paragraphs = [...(reading?.querySelectorAll<HTMLElement>('p') ?? [])];
    const paragraphIndex = paragraphs.indexOf(this);
    if (paragraphIndex !== -1) return rect(beforeHeight + 20 + paragraphIndex * 50 - scrollTop, 50);
    const readingHeight = 180 + Math.max(0, paragraphs.length - 1) * 50;
    if (this.dataset.node === 'reading') return rect(beforeHeight - scrollTop, readingHeight);
    if (this.dataset.node === 'after') return rect(beforeHeight + readingHeight - scrollTop, 220);
    return rect(0, 0);
  });
  const close = () => { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); };
  try {
    await act(async () => render(<WindowedScroll model={f.model} win={win} live={null} renderRow={() => <div/>}
      renderAcceptedView={snapshot => <SavedWindowContent model={f.model} snapshot={snapshot}/>}/>, host));
    const box = host.querySelector<HTMLElement>('.scroll')!;
    const detach = () => {
      box.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -1 }));
      box.scrollTop = 130;
      box.dispatchEvent(new Event('scroll', { bubbles: true }));
      expect(win.following.peek()).toBe(false);
    };
    const position = () => host.querySelector<HTMLElement>('[data-item-key][data-node="reading"]')!.getBoundingClientRect().top;
    if (detachInitially) { await act(async () => detach()); expect(position()).toBe(-30); }
    return { ...f, win, host, box, position, close, detach };
  } catch (error) { close(); throw error; }
}

it('keeps the same saved reading position when a live preview arrives', async () => {
  const f = await mounted();
  try {
    // The live arrival shares the commit with an above-anchor geometry change.
    const before = f.host.querySelector<HTMLElement>('[data-item-key][data-node="before"]')!;
    before.append('Grown before');
    await act(async () => {
      f.t.push({ t: 'live', thread_id: 'lead', attempt_id: 'live', gap: false, deltas: [{ offset: 0, reasoning: false, text: 'Live preview' }] });
      await settle(f.t, f.db);
    });
    expect(f.host.textContent).toContain('Live preview');
    expect(f.position()).toBe(-30);
  } finally { f.close(); }
});

it('keeps the same saved reading position when a new revision grows an earlier row', async () => {
  const f = await mounted(false);
  try {
    await act(async () => {
      const publication = f.publish({ nodes: rows('Grown before') });
      f.detach();
      await publication;
    });
    expect(f.host.textContent).toContain('Grown before');
    expect(f.position()).toBe(-30);
  } finally { f.close(); }
});


it('keeps a user scroll made after a revision publishes but before it renders', async () => {
  const f = await mounted(false);
  const revision = f.win.acceptedView.peek().revision;
  let moved = false;
  const unsubscribe = f.win.acceptedView.subscribe(() => {
    if (moved || f.win.acceptedView.peek().revision === revision) return;
    expect(f.host.textContent).not.toContain('New end');
    expect(f.position()).toBe(-30);
    moved = true;
    f.box.scrollTop = 155;
    f.box.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  try {
    await act(async () => {
      const publication = f.publish({ nodes: [...rows().slice(0, 2), { ...rows()[2], excerpt: 'New end' }] });
      f.detach();
      await publication;
    });
    expect(moved).toBe(true);
    expect(f.host.textContent).toContain('New end');
    expect(f.position()).toBe(-55);
  } finally { unsubscribe(); f.close(); }
});


it.each([
  { condition: 'retained', body: 'New earlier paragraph.\n\nKeep reading here', expectedTops: [-10], expectedScroll: 180 },
  { condition: 'removed', body: 'New earlier paragraph.\n\nDifferent prose', expectedTops: [], expectedScroll: 130 },
  { condition: 'duplicated', body: 'New earlier paragraph.\n\nKeep reading here\n\nKeep reading here', expectedTops: [40, 90], expectedScroll: 130 },
])('handles a reading paragraph $condition by the full body', async ({ body, expectedTops, expectedScroll }) => {
  let resize: ResizeObserverCallback | undefined;
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined; });
  const f = await mounted(false, [rows()[0], {
    node_id: 'reading', kind: 'assistant_response',
    items: [{ item_identity: 'answer', kind: 'text', text: 'Keep reading here', text_complete: false }],
  }, { node_id: 'after', kind: 'assistant_response', items: [{ item_identity: 'end', kind: 'text', text: 'After', text_complete: true }] }]);
  try {
    await act(async () => vi.dynamicImportSettled());
    const readingTops = () => [...f.host.querySelectorAll<HTMLElement>('[data-node="reading"] p')]
      .filter(p => p.textContent === 'Keep reading here').map(p => p.getBoundingClientRect().top);
    await act(async () => f.detach());
    expect(readingTops()).toEqual([-10]);
    const answer = f.db.answer.bind(f.db);
    f.db.answer = call => call.command === 'history.get'
      ? { ok: true, result: { node_id: 'reading', kind: 'assistant_response', text: body } }
      : answer(call);
    const button = [...f.host.querySelectorAll<HTMLButtonElement>('[data-node="reading"] button')]
      .find(button => button.textContent === f.model.t.value('convo.fullMessage'))!;
    await act(async () => { button.click(); await settle(f.t, f.db); });
    expect(f.host.textContent).toContain('New earlier paragraph.');
    expect(f.t.calls('history.get')).toHaveLength(1);
    await act(async () => { resize!([], {} as ResizeObserver); frame!(0); });
    expect(readingTops()).toEqual(expectedTops);
    expect(f.box.scrollTop).toBe(expectedScroll);
  } finally { f.close(); }
});
