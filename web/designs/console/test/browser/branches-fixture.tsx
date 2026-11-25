// Mounted Branches screen (#138) on the synthetic three-line family, for visual checks and captures.
// `?theme=light` switches the theme; `?lang=ja` the language. No owner, no Core: a fake transport answers.
import type { Prefs } from '../../../../ui-core/src';
import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { summary } from '../../../../data/test/harness';
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
Object.assign(window, { branchesFixture: { model, family, db, t, hint: async () => {
  const hintedTitle = "Release notes refreshed";
  family.titles.rel = hintedTitle;
  db.threads.rel!.title = hintedTitle;
  // A newly saved Thread makes the list signal change, which is how the production model
  // schedules the Branches family re-read after a list hint.
  db.threads.hinted = summary("hinted", { title: "Hint branch", parent_thread_id: "rel", state: "idle", activity: "idle", updated_at: "2026-11-07T10:18:00.000000+00:00" });
  family.paths.hinted = [...family.paths.rel!.slice(0, 6), { node_id: "h7", kind: "user", excerpt: "Continue the refreshed line." }];
  family.extra.push({ thread_id: "hinted", parent: "rel", at: "r6", title: "Hint branch" });
  t.push({ t: "changed", thread_ids: ["rel", "hinted"], list: true, config_changed: false });
  await settle(t, db);
} } });
