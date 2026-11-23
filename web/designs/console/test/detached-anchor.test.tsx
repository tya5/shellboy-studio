// @vitest-environment happy-dom
import '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { settle } from '../../../data/test/harness';
import { publicConversationFixture } from './conversation-fixture';
import { SavedWindowContent } from '../screens/Conversation';
import { WindowedScroll } from '../screens/WindowedScroll';

const rows = (above = 'Before') => [
  { node_id: 'before', kind: 'user', excerpt: above },
  { node_id: 'reading', kind: 'user', excerpt: 'Keep reading here' },
  { node_id: 'after', kind: 'user', excerpt: 'After' },
] as const;

afterEach(() => vi.restoreAllMocks());

async function mounted(detachInitially = true) {
  const f = await publicConversationFixture({ nodes: rows() });
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
    if (this.dataset.node === 'reading') return rect(beforeHeight - scrollTop, 180);
    if (this.dataset.node === 'after') return rect(beforeHeight + 180 - scrollTop, 220);
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
