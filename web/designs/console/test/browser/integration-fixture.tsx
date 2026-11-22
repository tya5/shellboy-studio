import { pendingReply } from "../../../../data/test/harness";
import { effect, signal } from '@preact/signals-core';
import { loadPrefs, savePrefs, type Prefs } from '../../../../ui-core/src';
import { summary, details } from '../../../../data/test/harness';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';

const params = new URLSearchParams(location.search);
const fixtureLang = params.get('lang') === 'ja' ? 'ja' as const : 'en' as const;
const ownSendFixture = params.get('view') === 'own-send';
const footerFixture = params.get('view') === 'footer-lifecycle';
const panelTabsFixture = params.get('view') === 'panel-tabs';
const sectionGeometryFixture = params.get('view') === 'section-geometry';
const fixtureOptions = sectionGeometryFixture ? { route: 'threads' as const, capabilities: ['history.window', 'thread.tags', 'thread.cwds'] } : footerFixture ? { route: 'conversation' as const, threadId: 'lead' } : ownSendFixture ? { route: 'conversation' as const, threadId: 'lead', capabilities: ['history.window'] } : panelTabsFixture ? { route: 'conversation' as const, threadId: 'lead', lang: fixtureLang } : params.get('view') === 'memory' ? { route: 'analytics' as const, section: 'memory' as const, lang: fixtureLang } : params.get('view') === 'sidebar' ? { lang: fixtureLang, capabilities: ['thread.tags', 'thread.cwds', 'history.window'] } : {};
if (params.get('view') === 'memory') document.documentElement.dataset.memoryFixture = fixtureLang;
const { model, t, db } = await fixtureModel({ ...fixtureOptions, configure(db) {
  if (sectionGeometryFixture) {
    db.threads = {
      lead: summary('lead', { title: 'Geometry lead', cwd: '/fixture/geometry', activity: 'tools' }),
      child: summary('child', { title: 'Geometry child', cwd: '/fixture/geometry', parent_id: 'lead', awaiting_human_count: 1 }),
      other: summary('other', { title: 'Geometry other', cwd: '/fixture/other', activity: 'failed' }),
    };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
    return;
  }
  if (ownSendFixture) { db.history.lead = []; return; }
  if (panelTabsFixture) db.replies = [];
  if (params.get('view') === 'sidebar') {
    db.threads = {
      lead: summary('lead', {title:'Leader',cwd:'/fixture/work',activity:'tools',tags:['pin']}),
      secretary: summary('secretary', {title:'Secretary',cwd:'/fixture/work',awaiting_named_count:1,tags:['pin','mail']}),
      parent: summary('parent', {title:'Core worker',cwd:'/fixture/work'}),
      child: summary('child', {title:'Child task',cwd:'/fixture/work',parent_id:'parent',awaiting_named_count:1}),
      other: summary('other', {title:'Studio worker',cwd:'/fixture/work',activity:'tools'}),
      outside: summary('outside', {title:'Architect',cwd:'/fixture/other',activity:'failed'}),
    };
    for (const id of Object.keys(db.threads)) db.details[id] = details(id);
    return;
  }
  if (params.get('state') === 'memory-busy') {
    const answer = db.answer.bind(db);
    db.answer = call => call.command === 'status' && (call.args as { memory?: boolean }).memory
      ? { ok: false, code: 'invalid_state', message: 'synthetic refusal', details: { phase: 'admission', request_may_have_been_applied: false } }
      : answer(call);
    return;
  }
  if (params.get('state') === 'memory-error') {
    const answer = db.answer.bind(db);
    db.answer = call => call.command === 'status' && (call.args as { memory?: boolean }).memory ? { ok: false, code: 'invalid_argument', message: 'unsupported memory field', details: { reason: 'unknown_field', name: 'memory', command: 'status', request_may_have_been_applied: false } } : answer(call);
    return;
  }
  if (params.get('state') === 'awaiting') {
    Object.assign(db.details.lead!, { parent_id: 'organization', shells_count: 1 });
    db.replies = [pendingReply('human-5', 'lead', {kind:'name',name:'human'}, 'P5_HUMAN_QUESTION'),
      pendingReply('thread-5', 'child', {kind:'thread',thread_id:'lead'}, 'P5_THREAD_DUTY')];
  }
  if (params.get('state') === 'waiting') db.threads.lead = summary('lead', {state:'running',activity:'waiting'});
  if (params.get('state') === 'completed') db.threads.lead = summary('lead', {state:'completed',activity:'completed'});
  if (params.get('state') !== 'running') return;
  db.work.lead = ['verify', 'inspect'].map((id) => ({ kind: 'shell', id, thread_id: 'lead', run_id: 'run-1', execution_id: id, state: 'running', started_at: '2026-11-07T10:19:00Z' }));
  db.shells.lead = [
    { execution_id: 'verify', state: 'running', description: 'Verify query ranking', command_excerpt: 'npm run check' },
    { execution_id: 'inspect', state: 'running', command_excerpt: 'git diff --check' },
  ];
} });
if (params.get('state') === 'empty') {
  db.history.lead = [];
  t.push({ t: 'changed', config_changed: false, thread_ids: ['lead'], list: false });
  await settle(t, db);
}
const send = t.send.bind(t);
let footerHistoryHeld = false;
let pendingOperationId: string | undefined;
t.send = (frame) => {
  const ok = send(frame);
  if (ownSendFixture && frame.t === 'call' && frame.command === 'message.send') pendingOperationId = frame.operation_id;
  else if (footerHistoryHeld && frame.t === 'call' && frame.command === 'history.window') db.answered.add(frame.id);
  else if (frame.t === 'call') queueMicrotask(() => void settle(t, db));
  return ok;
};
if (ownSendFixture) (window as unknown as { publishSavedOwnMessage: (deferred: boolean) => Promise<void> }).publishSavedOwnMessage = async deferred => {
  if (!pendingOperationId) throw new Error('No pending message.send call');
  db.history.lead = [{ node_id: 'browser-saved-own', kind: 'user', selection: { ordinal: 0 },
    ...(deferred ? { items: null, items_unavailable_reason: 'response_budget' as const, excerpt: 'Saved message body deferred' }
      : { items: [{ kind: 'text' as const, item_identity: 'browser-saved-own-body', text: 'Browser own-send witness', text_complete: true }] }),
    provenance: { sender: { kind: 'human' }, client_operation_id: pendingOperationId } }];
  t.push({ t: 'changed', config_changed: false, thread_ids: ['lead'], list: false });
  await settle(t, db);
};
const resizeStore = params.get('view') === 'splitters' ? {
  read: () => localStorage.getItem('splitter-fixture-prefs'),
  write: (value: string) => localStorage.setItem('splitter-fixture-prefs', value),
} : undefined;
const prefs = signal<Prefs>(resizeStore ? loadPrefs(resizeStore, DESIGNS) : { design: 'console', theme: params.get('theme') === 'light' ? 'light' : params.get('theme') === 'terminal' ? 'terminal' : params.get('theme') === 'auto' ? 'auto' : 'console', lang: fixtureLang, monitorView: 'cards', weights: { cached: 0.1, output: 5 } });
effect(() => { document.documentElement.dataset.ds = prefs.value.theme; });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: (change) => { prefs.value = { ...prefs.value, ...change }; if (resizeStore) savePrefs(resizeStore, prefs.value); }, submitToken: async () => true });

// Synthetic-only theme control; production App preferences still use the existing settings surface.
(window as unknown as { setFixtureTheme: (theme: 'console' | 'light' | 'terminal' | 'auto') => void }).setFixtureTheme = theme => {
  prefs.value = { ...prefs.value, theme };
};

if (panelTabsFixture) Object.assign(window, {
  publishPanelTabsCount() {
    db.details.lead!.pending_replies = { owed_by: { count: 1, exact: true }, asked_by: { count: 0, exact: true } };
    db.replies = [pendingReply('panel-tab-duty', 'child', {kind:'thread',thread_id:'lead'}, 'Synthetic reply duty')];
    t.push({ t: 'changed', thread_ids: ['lead'], list: false, config_changed: false });
  },
});

if (footerFixture) Object.assign(window, {
  async publishFooterState(state: 'not_started' | 'running' | 'completed') {
    const activity = state === 'running' ? 'tools' : state;
    db.threads.lead = summary('lead', { state, activity });
    db.details.lead = details('lead', { state, activity });
    t.push({ t: 'changed', config_changed: false, thread_ids: ['lead'], list: true });
    await settle(t, db);
    return model.selectedRow.peek()?.summary.state;
  },
  loadUnknownFooterThread() {
    footerHistoryHeld = true;
    db.details['loading-fixture'] = details('loading-fixture');
    model.applyRoute({ view: 'conversation', threadId: 'loading-fixture' });
  },
  disconnectFooter() { t.drop(); },
});
