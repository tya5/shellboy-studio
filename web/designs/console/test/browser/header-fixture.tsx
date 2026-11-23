import { signal } from '@preact/signals-core';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import type { Prefs } from '../../../../ui-core/src';

const candidate = { kind: 'summary', record_kind: 'retained_replacement', at: '2026-11-22T18:00:00Z' };
const f = await fixtureModel({ route:'conversation', threadId:'lead', lang:'ja', capabilities:['thread.tags','history.window'], configure(db) {
  Object.assign(db.details.lead!, {title:'Core worker', cwd:'/fixture/shellboy-sandbox', connection:'proxy', model:'gpt-6.2-sol', effort:'high',
    context_usage:{last_successful_attempt:{input_tokens:82000, cached_tokens:12000}}, effective_auto_compact_at:150000,
    last_compaction:{bounded_candidate:candidate,coverage:{latest_complete:false}}});
} });
const prefs = signal<Prefs>({ design:'console', theme:'console', lang:'ja', weights:{cached:0.1,output:5} });
mount(document.getElementById('app')!, { model:f.model, designs:DESIGNS, prefs, setPrefs:change=>{prefs.value={...prefs.value,...change};}, submitToken:async()=>true });
await settle(f.t,f.db);
Object.assign(window, { setCompactionCoverage:async (latest_complete:boolean) => {
  f.db.details.lead = { ...f.db.details.lead!, last_compaction:{bounded_candidate:candidate,coverage:{latest_complete}} };
  f.t.push({t:'changed', thread_ids:['lead'], list:false, config_changed:false});
  await settle(f.t,f.db);
} });
