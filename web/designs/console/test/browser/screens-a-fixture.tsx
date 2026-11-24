import { signal } from '@preact/signals-core';
import { mount } from '../../index';
import { DESIGNS } from '../../../registry';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import type { AnalyticsSection, Prefs } from '../../../../ui-core/src';

const view = new URLSearchParams(location.search).get('screen');
const route = view === 'monitor' || view === 'inbox' ? view : 'analytics';
const section = route === 'analytics' ? view as AnalyticsSection : undefined;
const f = await fixtureModel({ route, section });
const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'en', weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model: f.model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
await settle(f.t, f.db);
document.documentElement.dataset.fixtureReady = 'true';
