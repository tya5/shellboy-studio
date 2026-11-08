import type { Prefs } from '../../../../ui-core/src';
import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';

const { model, t, db } = await fixtureModel({ route: 'settings', section: 'general', capabilities: ['config.edit', 'connection.setup'] });
const values = {
  default_connection: 'local', default_model: 'test-model', ui: { language: 'en' },
  connections: { local: { base_url: 'http://localhost:1234/v1', default_effort: 'medium', ssl_verify: true } },
  compaction: { auto_at_tokens: 200000, segment_chars: 64000, reduce_rounds: 4, summary_max_chars: 20000, summary_max_percent: 5, summary_map_max_requests: 128, summary_reduce_max_requests: 16 },
  embedding: { connection: 'local', model: 'test-embedding' },
  indexing: { auto_history: true, auto_kinds: ['user', 'summary', 'assistant_response'] },
  limits: { data_warning_bytes: 1000, data_max_bytes: 2000, disk_free_min_bytes: 100 },
  retention: { tool_raw_days: 7, tool_raw_bytes: 1000, clipboard_days: 7, clipboard_bytes: 1000 },
};
const side = { present: true, valid: true, content_hash: 'fixture', values, credential_source: { local: 'none' } };
const original = db.answer.bind(db);
db.answer = (call) => call.command === 'config.get' ? { ok: true, result: { loaded: side, file: side, differs: false } } : original(call);
const send = t.send.bind(t);
t.send = (frame) => { const ok = send(frame); if (frame.t === 'call') queueMicrotask(() => void settle(t, db)); return ok; };
model.config.ensure();
await settle(t, db);
const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'en', monitorView: 'cards', weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: (change) => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
