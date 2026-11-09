import type { Lang, Prefs } from '../../../../ui-core/src';
import { signal } from '@preact/signals-core';
import { fixtureModel } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { showAuthMode } from '../../../../app/auth-mode';
import '../../../../app/auth-mode.css';

const params = new URLSearchParams(location.search);
const lang: Lang = params.get('lang') === 'ja' ? 'ja' : 'en';
Object.defineProperty(navigator, 'language', { value: lang, configurable: true });
const { model } = await fixtureModel({ route: 'settings', section: 'studio' });
model.lang.value = lang;
// Bootstrap is synthetic; no owner or real authentication endpoint is contacted.
window.fetch = async () => new Response(JSON.stringify({ authentication_required: params.get('auth') !== 'off' }), { status: 200 });
await showAuthMode();
const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang, monitorView: 'cards', weights: { cached: 0.1, output: 5 } });
mount(document.getElementById('app')!, { model, designs: DESIGNS, prefs, setPrefs: change => { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true });
document.documentElement.dataset.remoteCopyReady = 'true';
