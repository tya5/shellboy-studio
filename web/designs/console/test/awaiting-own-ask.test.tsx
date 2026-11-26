// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import { details, pendingReply, summary, type FakeOwnerDb } from '../../../data/test/harness';
import type { Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { App } from '../screens/App';

let host: HTMLElement | undefined, cleanup: (() => void) | undefined;
afterEach(() => { if (host) render(null, host); host?.remove(); host = undefined; cleanup?.(); cleanup = undefined; });

async function mount(configure: (db: FakeOwnerDb) => void) {
  const r = await fixtureModel({ route: 'conversation', threadId: 'lead', configure });
  host = document.createElement('div'); document.body.append(host); cleanup = () => { r.model.dispose(); r.data.stop(); };
  const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'en', weights: { cached: .1, output: 5 } });
  await act(async () => { render(<App context={{ model: r.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => true }} />, host!); await settle(r.t, r.db); });
  return { ...r, host: host! };
}

describe('Core protocol 43 awaiting_own_ask reply state', () => {
  it('shows a request awaiting its own ask with the Asked back relation caption', async () => {
    const r = await mount(db => {
      db.history.lead = [{ node_id: 'duty', kind: 'user', excerpt: 'Please review the release notes',
        provenance: { sender: { kind: 'model', thread_id: 'child' }, message: { expect_reply: true, reply_state: 'awaiting_own_ask' } } }];
    });
    const relation = r.host.querySelector('[data-message-relation="request"]');
    expect(relation?.textContent).toContain(r.model.t.value('convo.relation.awaiting_own_ask'));
  });

  it('counts an owed duty held by an own ask as open and captions only the duty Core lists', async () => {
    const r = await mount(db => {
      db.threads = { lead: summary('lead'), child: { ...summary('child'), title: 'Child Thread' } };
      db.details.lead = details('lead', { pending_replies: { owed_by: { count: 2, exact: true }, asked_by: { count: 0, exact: true },
        awaiting_own_ask: [{ message_id: 'held', blocking_message_id: 'question' }] } });
      db.replies = [pendingReply('held', 'child', { kind: 'thread', thread_id: 'lead' }, 'Held duty'),
        pendingReply('plain', 'child', { kind: 'thread', thread_id: 'lead' }, 'Plain duty')];
    });
    const tab = r.host.querySelector<HTMLButtonElement>('[data-panel-tab="reply-needed"]')!;
    expect(tab.querySelector('.panel-tab-count')?.textContent).toBe('2');
    await act(async () => { tab.click(); await settle(r.t, r.db); });
    const caption = r.model.t.value('convo.relation.awaiting_own_ask');
    expect(r.host.querySelector('[data-panel-row-id="held"]')?.textContent).toContain(caption);
    expect(r.host.querySelector('[data-panel-row-id="plain"]')?.textContent).not.toContain(caption);
  });
});
