// @vitest-environment happy-dom
import '@preact/signals';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { signal } from '@preact/signals';
import { describe, expect, it } from 'vitest';
import { flush } from '../../../data/test/harness';
import { fixtureModel, NOW, settle, usageItem, usagePage } from '../../../ui-core/test/fixture';
import { RollingOverview } from '../screens/RollingOverview';

describe('Analytics selected-bucket screen path', () => {
  it('does not read until a bucket is selected and switches the selected bucket to Thread model usage', async () => {
    let now = NOW;
    const { model, t, db } = await fixtureModel({ route: 'analytics', section: 'overview', settle: false, nowMs: () => now });
    const answer = db.answer.bind(db);
    db.answer = call => {
      const { group_by } = call.args as { group_by?: string };
      if (call.command !== 'usage.get' || (group_by !== 'thread' && group_by !== 'model')) return answer(call);
      const keys = group_by === 'thread' ? ['lead', ...Array.from({ length: 25 }, (_, i) => `thread-${i}`)]
        : Array.from({ length: 26 }, (_, i) => `model-${i}`);
      return { ok: true, result: { ...usagePage(keys.map((key, i) => usageItem(key, { count: 26 - i + (now === NOW ? 0 : 100), input: null, cached: null, output: null }))), group_by } };
    };
    const host = document.createElement('div');
    document.body.append(host);
    try {
      model.insights.rolling.enabled.value = true;
      await act(async () => { await settle(t, db); });
      await act(async () => { render(<RollingOverview context={{ model, designs: [], prefs: signal({ design: 'console', theme: 'light', lang: 'en', weights: { cached: 0.1, output: 5 } }), setPrefs() {}, submitToken: async () => false }} />, host); });
      expect(model.insights.bucketDrilldown.peek()).toBeUndefined();
      expect(t.calls('usage.get').some(call => (call.args as {group_by?: string}).group_by === 'thread')).toBe(false);
      expect(host.textContent).toContain('Owner-wide data');
      const next = host.querySelector<HTMLButtonElement>('button[aria-label="Previous bucket"]');
      expect(next).not.toBeNull();
      await act(async () => { next!.click(); await settle(t, db); });
      const selected = model.insights.bucketDrilldown.peek();
      expect(selected).toBeDefined();
      expect(selected?.key).toBe(model.insights.rolling.displayed.peek()?.selection?.key);
      expect(host.textContent).toContain('Threads in this hour');
      const discloseRanks = async () => {
        const table = host.querySelector('select')!.closest('section')!.querySelector('tbody')!;
        expect(table.querySelectorAll("tr")).toHaveLength(25);
        const more = [...host.querySelectorAll('button')].find(button => button.textContent === 'Show more usage rows');
        await act(async () => { more!.click(); });
        expect(table.querySelectorAll("tr")).toHaveLength(26);
      };
      await discloseRanks();
      const lastLink = [...host.querySelectorAll<HTMLAnchorElement>('tbody a')].at(-1)!;
      const section = lastLink.closest('section')!;
      lastLink.focus();
      expect(document.activeElement).toBe(lastLink);
      expect(lastLink.parentElement?.textContent).toContain('1 ·');
      const oldBounds = model.insights.bucketDrilldown.peek()!.until;
      now += 60_000;
      await act(async () => { t.push({ t: 'resync' }); await flush(); });
      expect(section.textContent).toContain('Showing the previous ranking');
      expect(model.insights.bucketDrilldown.peek()).toMatchObject({ until: oldBounds, stale: true });
      expect(document.activeElement).toBe(lastLink);
      expect(section.querySelectorAll('tbody tr')).toHaveLength(26);
      expect(lastLink.parentElement?.textContent).toContain('1 ·');
      const hourly = t.calls('usage.get').filter(call => (call.args as { group_by?: string }).group_by === 'hour').at(-1)!;
      await act(async () => { db.answered.add(hourly.id); t.ok(hourly.id, usagePage([])); await flush(); });
      expect(document.activeElement).toBe(lastLink);
      expect(model.insights.bucketDrilldown.peek()).toMatchObject({ until: oldBounds, stale: true });
      await act(async () => { await settle(t, db); });
      expect(section.textContent).not.toContain('Showing the previous ranking');
      expect(document.activeElement).toBe(lastLink);
      expect(section.querySelectorAll('tbody tr')).toHaveLength(26);
      expect(model.insights.bucketDrilldown.peek()).toMatchObject({ stale: false });
      expect(lastLink.parentElement?.textContent).toContain('101 ·');
      expect(Date.parse(model.insights.bucketDrilldown.peek()!.until)).toBe(Date.parse(oldBounds) + 60_000);
      const scope = host.querySelector<HTMLSelectElement>('select');
      expect(scope).not.toBeNull();
      await act(async () => {
        scope!.value = 'lead';
        scope!.dispatchEvent(new Event('change', { bubbles: true }));
        await settle(t, db);
      });
      expect(t.calls('usage.get').some(call => {
        const args = call.args as {group_by?: string; thread_id?: string};
        return args.group_by === 'model' && args.thread_id === 'lead';
      })).toBe(true);
      expect(host.textContent).toContain('Models in this hour');
      expect(host.textContent).toContain('Scope: Improve history search');
      expect(host.textContent).not.toContain('Scope: Improve history search ·');
      expect([...host.querySelector('select')!.options].map(option => option.value)).toEqual(['', 'lead']);
      await discloseRanks();
    } finally {
      render(null, host);
      host.remove();
      model.dispose();
    }
  });
});
