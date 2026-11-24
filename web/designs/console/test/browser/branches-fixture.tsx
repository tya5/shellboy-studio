// Mounted Branches screen (#138) on the synthetic three-line family, for visual checks and captures.
// `?theme=light` switches the theme; `?lang=ja` the language. No owner, no Core: a fake transport answers.
import type { Prefs } from '../../../../ui-core/src';
import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { branchesFamily } from '../fixtures/branches-family';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'light' ? 'light' : 'console';
const lang = query.get('lang') === 'ja' ? 'ja' : 'en';
document.documentElement.dataset.ds = theme;
let family!: ReturnType<typeof branchesFamily>;
const { model, t, db } = await fixtureModel({ route: 'branches', capabilities: ['history.window'], lang, configure(db) { family = branchesFamily(db); } });
const send = t.send.bind(t); t.send = (frame) => { const ok = send(frame); if (frame.t === 'call') queueMicrotask(() => void settle(t, db)); return ok; };
model.navigate({ view: 'branches', threadId: 'rel' });
await settle(t, db);
const prefs = signal<Prefs>({ design: 'console', theme, lang, weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: (c) => { prefs.value = { ...prefs.value, ...c }; }, submitToken: async () => true });
Object.assign(window, { branchesFixture: { model, family, db, t } });
