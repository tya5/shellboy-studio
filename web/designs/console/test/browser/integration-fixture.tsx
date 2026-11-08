import { signal } from '@preact/signals-core';
import type { Prefs } from '../../../../ui-core/src';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';

const params = new URLSearchParams(location.search);
const { model, t, db } = await fixtureModel();
if (params.get('state') === 'empty') {
  db.history.lead = [];
  t.push({ t: 'changed', thread_ids: ['lead'], list: false });
  await settle(t, db);
}
const send = t.send.bind(t);
t.send = (frame) => { const ok = send(frame); if (frame.t === 'call') queueMicrotask(() => void settle(t, db)); return ok; };
const prefs = signal<Prefs>({ design: 'console', theme: params.get('theme') === 'light' ? 'light' : 'console', lang: 'en', monitorView: 'cards', weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: (change) => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
