// @vitest-environment happy-dom
// Recreated from S7's diagnostic scenario (74f0e08); no private ancestry or data.
// These assertions describe the requested continuity, not the old diagnostic's green loss.
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { settle } from '../../../data/test/harness';
import type { Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { App } from '../screens/App';
let host: HTMLElement | undefined;
let cleanup: (() => void) | undefined;
afterEach(() => { if (host) render(null, host); host?.remove(); host = undefined; cleanup?.(); cleanup = undefined; });
async function setup() {
  const r = await fixtureModel({ capabilities: ['live.text'] });
  host = document.createElement('div'); document.body.append(host);
  cleanup = () => { r.model.dispose(); r.data.stop(); };
  const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'en', weights: { cached: 0.1, output: 5 } });
  act(() => render(<App context={{ model: r.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => true }} />, host!));
  const pump = async (fn: () => void) => { await act(async () => { fn(); await settle(r.t, r.db); for (let n = 0; n < 12; n++) await Promise.resolve(); }); };
  const live = (attempt_id: string, text: string) => r.t.push({ t: 'live', thread_id: 'lead', attempt_id, gap: false, deltas: [{ offset: 0, reasoning: false, text }] });
  return { ...r, host: host!, pump, live };
}
describe('visible conversation ownership across attempts', () => {
  it('keeps the prior visible body when a tool or subsequent generation starts before canonical readback', async () => {
    const r = await setup();
    await r.pump(() => r.live('synthetic-a1', 'FIRST_VISIBLE_BODY'));
    expect(r.host.textContent).toContain('FIRST_VISIBLE_BODY');
    const first = [...r.host.querySelectorAll('.msg')].find(e => e.textContent?.includes('FIRST_VISIBLE_BODY'));
    await r.pump(() => r.t.push({ t: 'live_end', thread_id: 'lead' }));
    await r.pump(() => r.live('synthetic-a2', 'SECOND_VISIBLE_BODY'));
    expect(r.host.textContent).toContain('FIRST_VISIBLE_BODY');
    expect(r.host.textContent).toContain('SECOND_VISIBLE_BODY');
    expect([...r.host.querySelectorAll('.msg')].find(e => e.textContent?.includes('FIRST_VISIBLE_BODY'))).toBe(first);
  });
});
