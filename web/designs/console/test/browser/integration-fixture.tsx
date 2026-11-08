import { effect, signal } from '@preact/signals-core';
import type { Prefs } from '../../../../ui-core/src';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';

const params = new URLSearchParams(location.search);
const { model, t, db } = await fixtureModel({ configure(db) {
  if (params.get('state') === 'awaiting') {
    Object.assign(db.details.lead!, { parent_id: 'organization', shells_count: 1, awaiting_replies: [
      { message_id: 'human-5', recipient_kind: 'human', recipient_thread_id: 'lead', excerpt: 'P5_HUMAN_QUESTION', delivery_status: 'accepted' },
      { message_id: 'thread-5', recipient_kind: 'thread', recipient_thread_id: 'child', excerpt: 'P5_THREAD_DUTY', delivery_status: 'applied' },
    ] });
  }
  if (params.get('state') !== 'running') return;
  db.work.lead = ['verify', 'inspect'].map((id) => ({ kind: 'shell', id, thread_id: 'lead', run_id: 'run-1', execution_id: id, state: 'running', started_at: '2026-11-07T10:19:00Z' }));
  db.shells.lead = [
    { execution_id: 'verify', state: 'running', description: 'Verify query ranking', command_excerpt: 'npm run check' },
    { execution_id: 'inspect', state: 'running', command_excerpt: 'git diff --check' },
  ];
} });
if (params.get('state') === 'empty') {
  db.history.lead = [];
  t.push({ t: 'changed', thread_ids: ['lead'], list: false });
  await settle(t, db);
}
const send = t.send.bind(t);
t.send = (frame) => { const ok = send(frame); if (frame.t === 'call') queueMicrotask(() => void settle(t, db)); return ok; };
const prefs = signal<Prefs>({ design: 'console', theme: params.get('theme') === 'light' ? 'light' : params.get('theme') === 'terminal' ? 'terminal' : 'console', lang: 'en', monitorView: 'cards', weights: { cached: 0.1, output: 5 } });
effect(() => { document.documentElement.dataset.ds = prefs.value.theme; });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: (change) => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
