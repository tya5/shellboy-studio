import { effect, signal } from '@preact/signals-core';
import type { Prefs } from '../../../../ui-core/src';
import { summary, details } from '../../../../data/test/harness';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';

const params = new URLSearchParams(location.search);
const fixtureLang = params.get('lang') === 'ja' ? 'ja' as const : 'en' as const;
const fixtureOptions = params.get('view') === 'memory' ? { route: 'analytics' as const, section: 'memory' as const, lang: fixtureLang } : params.get('view') === 'sidebar' ? { lang: fixtureLang, capabilities: ['thread.tags', 'thread.cwds', 'history.window'] } : {};
if (params.get('view') === 'memory') document.documentElement.dataset.memoryFixture = fixtureLang;
const { model, t, db } = await fixtureModel({ ...fixtureOptions, configure(db) {
  if (params.get('view') === 'sidebar') {
    db.threads = {
      lead: summary('lead', {title:'Leader',cwd:'/fixture/work',activity:'tools',tags:['pin']}),
      secretary: summary('secretary', {title:'Secretary',cwd:'/fixture/work',awaiting_human_count:1,tags:['pin','mail']}),
      parent: summary('parent', {title:'Core worker',cwd:'/fixture/work'}),
      child: summary('child', {title:'Child task',cwd:'/fixture/work',parent_id:'parent',awaiting_human_count:1}),
      other: summary('other', {title:'Studio worker',cwd:'/fixture/work',activity:'tools'}),
      outside: summary('outside', {title:'Architect',cwd:'/fixture/other',activity:'failed'}),
    };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
    return;
  }
  if (params.get('state') === 'memory-error') {
    const answer = db.answer.bind(db);
    db.answer = call => call.command === 'status' && (call.args as { memory?: boolean }).memory ? { ok: false, code: 'invalid_argument', message: 'unsupported memory field', details: { reason: 'unknown_field', name: 'memory', command: 'status', request_may_have_been_applied: false } } : answer(call);
    return;
  }
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
const prefs = signal<Prefs>({ design: 'console', theme: params.get('theme') === 'light' ? 'light' : params.get('theme') === 'terminal' ? 'terminal' : 'console', lang: fixtureLang, monitorView: 'cards', weights: { cached: 0.1, output: 5 } });
effect(() => { document.documentElement.dataset.ds = prefs.value.theme; });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: (change) => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });

// Synthetic-only theme control; production App preferences still use the existing settings surface.
(window as unknown as { setFixtureTheme: (theme: 'console' | 'light' | 'terminal') => void }).setFixtureTheme = theme => {
  prefs.value = { ...prefs.value, theme };
};
