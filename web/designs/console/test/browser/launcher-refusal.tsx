import { signal } from '@preact/signals-core';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { fixtureModel } from '../../../../ui-core/test/fixture';
import type { Prefs } from '../../../../ui-core/src';

const { model, t } = await fixtureModel({ route: 'monitor', lang: 'ja' });
const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'ja', weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
Object.assign(window, { showLauncherRefusal: (message: string) => t.push({ t: 'launcher_diagnostic', message }) });
