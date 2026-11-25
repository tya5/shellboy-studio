// @vitest-environment happy-dom
import '@preact/signals';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import { RollingOverview } from '../screens/RollingOverview';

describe('Analytics selected-bucket screen path', () => {
  it('does not read until a bucket is selected and switches the selected bucket to Thread model usage', async () => {
    const { model, t, db } = await fixtureModel({ route: 'analytics', section: 'overview', settle: false });
    const host = document.createElement('div');
    document.body.append(host);
    try {
      model.insights.rolling.enabled.value = true;
      await act(async () => { await settle(t, db); });
      await act(async () => { render(<RollingOverview model={model} />, host); });
      expect(model.insights.bucketDrilldown.peek()).toBeUndefined();
      expect(t.calls('usage.get').some(call => (call.args as {group_by?: string}).group_by === 'thread')).toBe(false);
      expect(host.textContent).toContain('Owner-wide data');
      const next = host.querySelector<HTMLButtonElement>('button[aria-label="Next bucket"]');
      expect(next).not.toBeNull();
      await act(async () => { next!.click(); await settle(t, db); });
      const selected = model.insights.bucketDrilldown.peek();
      expect(selected).toBeDefined();
      expect(selected?.key).toBe(model.insights.rolling.displayed.peek()?.selection?.key);
      expect(host.textContent).toContain('Threads in this hour');
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
    } finally {
      render(null, host);
      host.remove();
      model.dispose();
    }
  });
});
