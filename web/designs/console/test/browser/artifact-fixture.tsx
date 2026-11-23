import { signal } from '@preact/signals-core';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import type { Prefs } from '../../../../ui-core/src';

const stamp = '2026-11-22T18:10:00Z';
const version = (n:number, uri:string, title:string, mime:string|null) => ({ version:n, uri, title, mime, created_at:stamp });
const row = (id:string, latest:ReturnType<typeof version>) => ({ artifact_id:id, thread_id:'lead', created_at:stamp, updated_at:stamp, latest });
const rows = [row('report', version(3, '/fixture/reports/weekly-v3.md', '週次レポートの下書き', 'text/markdown')),
 row('diagram', version(1, '/fixture/graph.svg', '依存関係の図', 'image/svg+xml')),
 row('price', version(1, 'https://example.invalid/pricing.pdf', '料金表（公開ページの PDF）', 'application/pdf')),
 row('notes', version(1, 'example:notes', '打ち合わせメモ（11月20日の定例と次の手順）', null))];
const old = version(2, '/fixture/reports/weekly-v2.md', '週次レポートの下書き（案）', 'text/markdown');
const files = ['screenshot-1122.png', '要件メモ.txt'].map((name, i) => ({ attachment_id:`attachment-${i}`, thread_id:'lead', path:`/fixture/${name}`, kind:i?'file':'image', delivery_status:'applied', source_node_id:`input-${i}`, selected:true, managed:false }));
const f = await fixtureModel({ route:'conversation', threadId:'lead', lang:'ja', capabilities:['attachment.list.page','artifact.list.page','history.window'], configure(db) {
 const answer = db.answer.bind(db); db.answer = call => {
  if (call.command === 'artifact.list') return {ok:true,result:{items:rows}};
  if (call.command === 'attachment.list') return {ok:true,result:{items:files}};
  if (call.command === 'artifact.get') {
   const args = call.args as {artifact_id:string;version?:number};
   const item = rows.find(r => r.artifact_id===args.artifact_id)!;
   const { latest, ...identity } = item;
   return args.version === undefined ? {ok:true,result:{...item,versions:{items:[3,2,1].map(n=>({version:n,created_at:stamp}))}}}
    : {ok:true,result:{...identity,version:args.version===2?old:latest}};
  }
  return answer(call);
 };
}});
const previewCalls: unknown[] = [];
const originalFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
 if (input !== '/artifact-content') return originalFetch(input, options);
 const target = JSON.parse(String(options?.body));
 previewCalls.push(target);
 return Promise.resolve(new Response('# 週次レポート（案）\n\n- 今週の進捗\n- 次の手順', { status:200 }));
};
const prefs = signal<Prefs>({ design:'console', theme:'console', lang:'ja', weights:{cached:0.1,output:5} });
mount(document.getElementById('app')!, { model:f.model, designs:DESIGNS, prefs, setPrefs:change=>{prefs.value={...prefs.value,...change};}, submitToken:async()=>true });
await settle(f.t,f.db);
async function flushOwner() { await new Promise(requestAnimationFrame); await settle(f.t,f.db); await new Promise(requestAnimationFrame); await settle(f.t,f.db); }
Object.assign(window, { runArtifactFixture: async (action:'list'|'detail'|'old') => {
 if (action === 'list') {
  if (innerWidth < 1180) document.querySelector<HTMLButtonElement>('.work-strip button')!.click();
  await flushOwner();
  document.querySelector<HTMLButtonElement>('[data-panel-tab="possessions"]')!.click();
 } else if (action === 'detail') document.querySelector<HTMLButtonElement>('[data-panel-row-id="report"] button')!.click();
 else {
  const disclosure = document.querySelector<HTMLDetailsElement>('[data-panel-detail] details')!;
  disclosure.open=true;
  disclosure.querySelector<HTMLButtonElement>('[data-panel-row-id="report:v2"] button')!.click();
 }
 await flushOwner();
 const panel = document.querySelector<HTMLElement>('[data-panel-root]')!;
 const content = panel.querySelector<HTMLElement>('[data-panel-detail]');
 const found = Array.from(panel.querySelectorAll<HTMLElement>('[data-panel-list="possessions"] [data-panel-row-id]'));
 return { width:innerWidth, panels:document.querySelectorAll('[data-panel-root]').length, sheet:!!panel.closest('dialog[open]'), bands:[...panel.querySelectorAll('[data-panel-list="possessions"] h3 > span:first-child')].map(el=>el.textContent), rows:found.map(el=>el.dataset.panelRowId), heights:found.map(el=>el.getBoundingClientRect().height), detail:content?.textContent, preview:content?.querySelector('.artifact-preview')?.textContent, previewCalls, overflow:panel.scrollWidth>panel.clientWidth+1 };
}});
