import { signal } from '@preact/signals-core';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import type { Prefs } from '../../../../ui-core/src';

const f = await fixtureModel({ route: 'conversation', threadId: 'lead', capabilities: ['thread.settings', 'config.edit', 'history.window'], configure(db) {
  const base = db.answer.bind(db);
  db.answer = call => {
    const args = call.args as { connection?: string; model?: string; effort?: string };
    if (call.command === 'config.get') {
      const side = { present: true, content_hash: 'fixture', valid: true, values: { connections: { c: {}, studio: {} } }, redacted_fields: [] };
      return { ok: true, result: { loaded: side, file: side, differs: false, restart: { all_fields_require_restart: false } } };
    }
    if (call.command === 'model.list') return { ok: true, result: { api: 'responses', connection: args.connection, models: args.connection === 'c' ? ['model-a'] : ['model-b'], unavailable_features: [] } };
    if (call.command === 'thread.set') {
      f.db.details.lead = { ...f.db.details.lead!, ...args };
      return { ok: true, result: f.db.details.lead };
    }
    return base(call);
  };
} });
const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'en', weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model: f.model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = {...prefs.value, ...change}; }, submitToken: async () => true });
Object.assign(window, { flushOwner: () => settle(f.t, f.db), writes: () => f.t.calls('thread.set').map(call => call.args), hint: async () => { f.t.push({ t: 'changed', thread_ids: ['lead'], list: false, config_changed: false }); await settle(f.t, f.db); } });
