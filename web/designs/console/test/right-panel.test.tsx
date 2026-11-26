import { pendingReply } from "../../../data/test/harness";
// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-ignore -- node built-in, no Node types in the browser build
import { readFileSync } from 'node:fs';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { details, summary, settle, flush } from '../../../data/test/harness';
import type { DesignContext, Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { loadPrefs, savePrefs, type PrefStore } from '../../../ui-core/src/prefs';
import { App } from '../screens/App';

const layoutCss=readFileSync('designs/console/system/layout.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
/** layout.css as a browser applies it in a container of `width`; happy-dom does not evaluate container queries. */
function layoutAtContainerWidth(width:number) {
 let out='';
 for (let at=0;at<layoutCss.length;) {
  const start=layoutCss.indexOf('@container app (',at);
  if (start<0) {out+=layoutCss.slice(at);break;}
  out+=layoutCss.slice(at,start);
  const open=layoutCss.indexOf('{',start);
  const query=/\((min|max)-width:(\d+)px\)/.exec(layoutCss.slice(start,open))!;
  let depth=1,end=open+1;
  for (;depth;end++) depth+=layoutCss[end]==='{'?1:layoutCss[end]==='}'?-1:0;
  const limit=Number(query[2]);
  if (query[1]==='min' ? width>=limit : width<=limit) out+=layoutCss.slice(open+1,end-1);
  at=end;
 }
 return out;
}

let host: HTMLElement | undefined;
afterEach(() => { if (host) render(null, host); host?.remove(); host = undefined; });

async function setup(capabilities?: string[]) {
 const f=await fixtureModel({route:'conversation',threadId:'lead',lang:'ja',capabilities,configure(db){
  db.threads={lead:summary('lead')};
  db.details.child=details("child",{title:"Child review Thread"});
  db.details.lead=details('lead',{run_id:'run-1',model:'model-a',effort:'high',connection:'test-connection',cwd:'/fixture/panel',pending_replies:{owed_by:{count:1,exact:true},asked_by:{count:1,exact:true}}});
  db.replies = [pendingReply("owed-human", "lead", {kind:"name",name:"human"}, "Need an answer from this conversation"),
    pendingReply("asked-child", "child", {kind:"thread",thread_id:"lead"}, "Waiting for the child Thread")];
  db.replies[0]!.created_at = "2026-11-07T10:19:57.600Z";
  db.work.lead=[{kind:'shell',id:'shell-running',thread_id:'lead',run_id:'run-1',execution_id:'shell-running',state:'running',started_at:'2026-11-21T00:00:00Z'}];
  db.shells.lead=[{execution_id:'shell-running',state:'running',description:'Current verification',command_excerpt:'npm test'}];
 }});
 const stored:{value:string|null}={value:null};
 const store:PrefStore={read:()=>stored.value,write:value=>{stored.value=value;}};
 const prefs=signal<Prefs>({...loadPrefs(store,DESIGNS),lang:'ja'});
 const context:DesignContext={model:f.model,prefs,setPrefs:change=>{prefs.value={...prefs.value,...change};savePrefs(store,prefs.value);f.model.lang.value=prefs.value.lang;},designs:DESIGNS,submitToken:async()=>false};
 host=document.createElement('div');document.body.append(host);
 Object.defineProperty(host,'clientWidth',{configurable:true,value:1280});
 await act(async()=>{render(<App context={context}/>,host!);await settle(f.t,f.db);});
 Object.defineProperty(host.querySelector(".app"), "clientWidth", { configurable:true, value:1280 });
 return {...f,host,context,prefs,store,stored};
}

describe('right panel purpose',()=>{
 it.each([1280,390])('reads definitions on hints and uses exact Activity commands at %i', async width => {
  const original = ResizeObserver;
  let reveal: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class extends original {
    constructor(cb: ResizeObserverCallback) { super(cb); reveal = () => cb([], this); }
    override observe(node: Element) { if (node.matches('[data-panel-root]') && width === 1280) reveal?.(); }
  });
  const f=await setup();
  const at='2026-11-21T00:00:00Z';
  let schedules=[{schedule_id:'sched',enabled:true,cron:'0 9 * * *',next_at:at,cwd:'/fixture',command:'echo test',description:'Schedule fixture',latest:{state:'running',started_at:at,output_tail:'sample output'}}];
  let service={service_id:'svc',enabled:false,cwd:'/fixture',command:'echo service',description:'Service fixture',latest:null};
  const answer=f.db.answer.bind(f.db);
  f.db.answer=call=>{
   if(call.command==='schedule.list') return {ok:true,result:{thread_id:'lead',items:schedules}};
   if(call.command==='service.list') return {ok:true,result:{thread_id:'lead',items:[service]}};
   if(/^(schedule|service)\./.test(call.command)) return {ok:true,result:{}};
   return answer(call);
  };
  const pump=async(work:()=>void)=>{await act(async()=>work());await act(async()=>{await settle(f.t,f.db);});};
  const hint=()=>f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false});
  const click=(selector:string)=>f.host.querySelector<HTMLButtonElement>(selector)!.click();
  const schedule='[data-schedule-row="schedule"]';
  const serviceRow='[data-schedule-row="service"]';
  try {
   Object.defineProperty(f.host.querySelector('.app'), 'clientWidth', {configurable:true,value:width});
   if(width===390) await pump(()=>click('.phone-panel-footer .shell-toggle-panel'));
   else await pump(hint);
   const list=f.host.querySelector('[data-panel-list="work"]')!;
   expect(list.querySelector('[data-panel-row-id="shell-running"]')).not.toBeNull();
   for(const command of ['schedule.list','service.list']) expect(f.t.calls(command).at(-1)?.args).toEqual({thread_id:'lead'});
   const opener=list.querySelector<HTMLButtonElement>(`${schedule} .panel-list-main`)!;
   const priorRead=f.t.calls('schedule.list').at(-1)?.id;
   await act(async()=>{
    hint();
    for(let i=0;i<10;i++) {
     await flush(32);
     for(const call of f.t.calls().filter(call=>call.command!=='schedule.list'&&!f.db.answered.has(call.id))) {
      f.db.answered.add(call.id);
      const response=f.db.answer(call);
      if(response.ok) f.t.ok(call.id,response.result); else f.t.ownerError(call.id,response.code);
     }
    }
   });
   const held=f.t.calls('schedule.list').at(-1)!;
   expect(held.id).not.toBe(priorRead);
   expect(f.db.answered.has(held.id)).toBe(false);
   expect(list.querySelector(`${schedule} .panel-list-main`)).toBe(opener);
   expect(list.textContent).not.toContain(f.model.t.value('common.loading'));
   await pump(()=>{});
   await pump(()=>opener.click());
   const log=f.host.querySelector<HTMLPreElement>('[data-panel-detail] pre.log.boxed');
   expect(log?.textContent).toBe('sample output');
   expect(log?.tabIndex).toBe(0);
   await pump(()=>click('[data-panel-back]'));
   expect(document.activeElement).toBe(opener);
   await pump(()=>click(`${schedule} [role="switch"]`));
   expect(f.t.calls('schedule.disable').at(-1)?.args).toEqual({schedule_id:'sched'});
   expect(list.querySelector(`${schedule} [role="switch"]`)?.getAttribute('aria-checked')).toBe('true');
   schedules=[{...schedules[0]!,enabled:false}]; await pump(hint);
   expect(list.querySelector(`${schedule} [role="switch"]`)?.getAttribute('aria-checked')).toBe('false');
   await pump(()=>click(`${schedule} [role="switch"]`));
   expect(f.t.calls('schedule.enable').at(-1)?.args).toEqual({schedule_id:'sched'});
   await pump(()=>click(`${serviceRow} button[aria-label="Service fixture を開始"]`));
   expect(f.t.calls('service.start').at(-1)?.args).toEqual({service_id:'svc'});
   service={...service,enabled:true}; await pump(hint);
   await pump(()=>click(`${serviceRow} button[aria-label="Service fixture を停止"]`));
   expect(f.t.calls('service.stop').at(-1)?.args).toEqual({service_id:'svc'});
   await pump(()=>opener.click());
   await pump(()=>click('[data-panel-detail] button[aria-label="Schedule fixture を削除"]'));
   expect(f.host.querySelector('[role="alertdialog"]')?.textContent).toContain('実行中の場合はシェルを停止');
   expect(f.t.calls('schedule.remove')).toHaveLength(0);
   await pump(()=>click('[role="alertdialog"] .work-sheet-body button'));
   expect(f.t.calls('schedule.remove').at(-1)?.args).toEqual({schedule_id:'sched'});
   schedules=[]; await pump(hint);
   expect(list.querySelector(schedule)).toBeNull();
   expect(f.host.querySelector('[data-panel-detail] .muted.caption')?.textContent).toBe('このスケジュールまたはサービスは現在利用できません。');
   await pump(()=>click('[data-panel-back]'));
   expect(f.host.querySelector('[data-panel-detail]')).toBeNull();
  } finally {f.model.dispose();f.data.stop();vi.unstubAllGlobals();}
 });

 it('captures the Run ID and opener through Activity confirmation when thread details change', async () => {
  const f=await setup();
  const hint=()=>f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false});
  const text=f.model.t.value;
  try {
   f.db.threads.lead=summary('lead',{state:'completed'});
   await act(async()=>{hint();await settle(f.t,f.db);});
   const trigger=[...f.host.querySelectorAll<HTMLButtonElement>('[data-panel-list="work"] button')].find(button=>button.textContent===text('action.stopEverything'));
   expect(trigger).toBeDefined();
   await act(async()=>trigger!.click());
   expect(f.host.querySelector('[role="alertdialog"]')?.textContent).toContain(text('action.stopEverythingDescription'));
   f.db.details.lead={...f.db.details.lead!,run_id:'replacement-run'};
   await act(async()=>{hint();await settle(f.t,f.db);});
   const confirm=f.host.querySelector<HTMLButtonElement>('[role="alertdialog"] button.btn-stop')!;
   await act(async()=>confirm.click());
   const stop=f.t.calls('run.stop').at(-1)!;
   expect(stop.args).toEqual({run_id:'run-1'});
   expect(f.t.calls('shell.stop')).toHaveLength(0);
   f.t.ownerError(stop.id,'run_not_running','Run is no longer live');
   await act(async()=>{await flush(8);});
   expect(f.host.querySelector('[role="alert"]')?.textContent).toContain('Run is no longer live');
   expect(trigger?.isConnected).toBe(true);
   expect(document.activeElement).toBe(trigger);
  } finally {f.model.dispose();f.data.stop();}
 });

 it('retains pending Activity rows and the tab count while status refreshes', async () => {
  const f=await setup();
  const hint=()=>f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false});
  const row=()=>f.host.querySelector('[data-panel-list="work"] [data-panel-row-id="pending"]');
  const count=()=>f.host.querySelector('[data-panel-tab="work"] .panel-tab-count')?.textContent;
  const activity=()=>f.host.querySelector('[data-panel-list="work"]')?.textContent;
  const text=f.model.t.value;
  try {
   f.db.bodies.pending='Pending fixture message';
   f.db.work.lead=[{kind:'message',id:'pending',message_id:'pending',thread_id:'lead',state:'held'}];
   await act(async()=>{hint();await settle(f.t,f.db);});
   const retained=row();
   expect(retained?.textContent).toContain('Pending fixture message');
   expect(count()).toBe('1');
   f.db.work.lead=[];
   await act(async()=>{
    hint();
    // Let other reads finish without answering the new work read.
    for (let i=0;i<10;i++) {
     await flush(32);
     for (const call of f.t.calls().filter(call=>call.command!=='status'&&!f.db.answered.has(call.id))) {
      f.db.answered.add(call.id);
      const response=f.db.answer(call);
      if (response.ok) f.t.ok(call.id,response.result); else f.t.ownerError(call.id,response.code);
     }
    }
   });
   const refresh=f.t.calls('status').at(-1)!;
   expect(f.db.answered.has(refresh.id)).toBe(false);
   expect(row()).toBe(retained);
   expect(count()).toBe('1');
   expect(activity()).not.toContain(text('panel.empty.work'));
   expect(activity()).toContain(text('work.stale'));
   await act(async()=>row()!.querySelector<HTMLButtonElement>('.panel-list-main')!.click());
   const cancel=[...f.host.querySelectorAll<HTMLButtonElement>('[data-panel-detail] button')].find(item=>item.textContent===text('work.cancel'));
   expect(cancel?.disabled).toBe(true);
   Object.defineProperty(f.host.querySelector('.app'), 'clientWidth', {configurable:true,value:390});
   await act(async()=>f.host.querySelector<HTMLButtonElement>('.phone-panel-footer .shell-toggle-panel')!.click());
   const sheet=f.host.querySelector<HTMLDialogElement>('dialog.work-sheet[open]')!;
   expect(sheet.open).toBe(true);
   await act(async()=>sheet.querySelector<HTMLButtonElement>('[data-panel-tab="work"]')!.click());
   expect(row()?.textContent).toContain('Pending fixture message');
   expect(count()).toBe('1');
   expect(activity()).toContain(text('work.stale'));
   expect(activity()).not.toContain(text('panel.empty.work'));
   await act(async()=>{await settle(f.t,f.db);});
   expect(row()).toBeNull();
   expect(count()).toBeUndefined();
   expect(activity()).toContain(text('action.stopEverything'));
  } finally {f.model.dispose();f.data.stop();}
 });

 it('uses the canonical unknown sender label in the reply list', async () => {
  const f=await setup();
  try {
   f.db.replies[1]!.sender={kind:"unknown"};
   await act(async()=>{f.t.push({t:"changed",config_changed:false,thread_ids:["lead"],list:false});await settle(f.t,f.db);});
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="reply-needed"]')!.click());
   const row=f.host.querySelector('[data-panel-row-id="asked-child"]')!;
   expect(row.textContent).toContain(f.model.t.value("convo.unknownSender"));
   expect(row.textContent).not.toContain(f.model.t.value("work.textUnavailable"));
  } finally {f.model.dispose();f.data.stop();}
 });

 it('resolves owed model sender titles from reply-page candidates and shows the header fallback id', async () => {
  const f=await setup();
  try {
   f.db.replies=[pendingReply("owed-model","child",{kind:"thread",thread_id:"lead"},"Question from child")];
   await act(async()=>{f.t.push({t:"changed",config_changed:false,thread_ids:["lead"],list:false});await settle(f.t,f.db);});
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="reply-needed"]')!.click());
   await act(async()=>{await settle(f.t,f.db);});
   const row=f.host.querySelector('[data-panel-row-id="owed-model"]')!;
   expect(row.textContent).toContain("Child review Thread");
   expect(row.textContent).not.toContain(f.model.t.value("convo.modelSender"));
  } finally {f.model.dispose();f.data.stop();}
 });

 it('shows model sender short id when the sender-title resolver is unresolved', async () => {
  const f=await setup();
  try {
   f.db.replies=[pendingReply("owed-model","missing-child",{kind:"thread",thread_id:"lead"},"Question from child")];
   await act(async()=>{f.t.push({t:"changed",config_changed:false,thread_ids:["lead"],list:false});await settle(f.t,f.db);});
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="reply-needed"]')!.click());
   await act(async()=>{await settle(f.t,f.db);});
   const row=f.host.querySelector('[data-panel-row-id="owed-model"]')!;
   expect(row.textContent).toContain(f.model.t.value("convo.modelSender"));
   expect(row.textContent).toContain("missing-");
  } finally {f.model.dispose();f.data.stop();}
 });

 it('opens the right panel from its footer toggle at a 1000px container and answers a reply from the sheet', async () => {
  const f=await setup();
  const style=document.createElement('style');
  style.textContent=layoutAtContainerWidth(1000);
  document.head.append(style);
  try {
   Object.defineProperty(f.host.querySelector('.app'), 'clientWidth', {configurable:true,value:1000});
   const footer=f.host.querySelector<HTMLElement>('.phone-panel-footer')!;
   expect(getComputedStyle(f.host.querySelector('.details')!).display).toBe('none');
   expect(getComputedStyle(footer).display).not.toBe('none');
   const toggle=footer.querySelector<HTMLButtonElement>('.shell-toggle-panel')!;
   expect(toggle.getAttribute('aria-expanded')).toBe('false');
   await act(async()=>toggle.click());
   const sheet=f.host.querySelector<HTMLDialogElement>('dialog.work-sheet')!;
   expect(sheet.open).toBe(true);
   expect(sheet.querySelector('[data-phone-panel]')).not.toBeNull();
   expect(f.host.querySelector('.phone-panel-footer .shell-toggle-panel')?.getAttribute('aria-expanded')).toBe('true');
   await act(async()=>sheet.querySelector<HTMLButtonElement>('[data-panel-tab="reply-needed"]')!.click());
   await act(async()=>sheet.querySelector<HTMLButtonElement>('[data-panel-row-id="asked-child"] button')!.click());
   await act(async()=>{await settle(f.t,f.db);});
   const detail=sheet.querySelector('#panel-page-reply-needed [data-panel-detail]')!;
   expect(detail).not.toBeNull();
   expect(detail.querySelector('textarea')).not.toBeNull();
   expect([...detail.querySelectorAll<HTMLAnchorElement>('a')].map(a=>a.getAttribute('href'))).toEqual([expect.stringContaining('child')]);
   await act(async()=>sheet.querySelector<HTMLButtonElement>('.work-sheet-head button')!.click());
   expect(f.host.querySelector('dialog[open]')).toBeNull();
   expect(document.activeElement).toBe(f.host.querySelector('.phone-panel-footer .shell-toggle-panel'));
  } finally {style.remove();f.model.dispose();f.data.stop();}
 });

 it('keeps one container rule for hiding the panel and showing its footer toggle', () => {
  const at=(width:number)=>{
   const style=document.createElement('style');
   style.textContent=layoutAtContainerWidth(width);
   document.head.append(style);
   const app=document.createElement('div');app.className='app';
   app.innerHTML='<aside class="details" data-panel-root=""></aside><div class="phone-panel-footer"></div>';
   document.body.append(app);
   try {
    return [getComputedStyle(app.querySelector('.details')!).display==='none', getComputedStyle(app.querySelector('.phone-panel-footer')!).display!=='none'];
   } finally {app.remove();style.remove();}
  };
  for (const width of [390,899,900,1000,1179]) expect(at(width),String(width)).toEqual([true,true]);
  for (const width of [1180,1280]) expect(at(width),String(width)).toEqual([false,false]);
 });

 it('labels the right-panel detail by its tab and translates delivery states', async () => {
  const f=await setup(['attachment.list.page']);
  const answer=f.db.answer.bind(f.db);
  const attachment=(id:string,delivery_status:string)=>({attachment_id:id,source_node_id:`source-${id}`,thread_id:'lead',path:`/fixture/${id}.txt`,kind:'file',delivery_status,selected:true,managed:false});
  f.db.answer=call=>call.command==='attachment.list'
   ? {ok:true,result:{items:[attachment('applied-file','applied'),attachment('held-file','held'),attachment('cancelled-file','cancelled')]}} : answer(call);
  try {
   f.db.work.lead!.push({kind:'message',id:'queued',thread_id:'lead',message_id:'queued',state:'accepted',excerpt:'Queued'});
   await act(async()=>{f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false});await settle(f.t,f.db);});
   const open=async(tab:string,id:string)=>{
    await act(async()=>f.host.querySelector<HTMLButtonElement>(`[data-panel-tab="${tab}"]`)!.click());
    await act(async()=>{await settle(f.t,f.db);});
    await act(async()=>f.host.querySelector<HTMLButtonElement>(`#panel-page-${tab} [data-panel-row-id="${id}"] button`)!.click());
    await act(async()=>{await settle(f.t,f.db);});
    return f.host.querySelector<HTMLElement>(`#panel-page-${tab} [data-panel-detail]`)!;
   };
   const owed=await open('reply-needed','asked-child');
   expect(owed.querySelector('.q .lab')?.textContent).toBe('要返信');
   expect(owed.querySelector('[data-status="awaiting"]')).toBeNull();
   expect(owed.textContent).not.toContain('返信待ち');
   expect(owed.innerHTML).not.toContain('あなた待ち');
   const asked=await open('awaiting-reply','owed-human');
   expect(asked.querySelector('.q .lab')?.textContent).toBe('返信待ち');
   expect(asked.querySelector('[data-status="awaiting"]')?.getAttribute('aria-label')).toBe('あなた待ち');
   const status=(detail:HTMLElement)=>[...detail.querySelectorAll('dt')].find(dt=>dt.textContent===f.model.t.value('details.status'))?.nextElementSibling?.textContent;
   expect(status(await open('work','queued'))).toBe('受付済み');
   const states:(string|null|undefined)[]=[];
   for (const id of ['applied-file','held-file','cancelled-file']) {
    const detail=await open('possessions',id);
    states.push(status(detail));
    await act(async()=>detail.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
   }
   expect(states).toEqual(['反映済み','保留中','取消済み']);
  } finally {f.model.dispose();f.data.stop();}
 });

 it.each(['finder', null] as const)('keeps artifact order and handles reveal capability %s', async platform => {
  let succeeds = false;
  const fetchArtifact = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST'
    ? succeeds || (init.body && JSON.parse(String(init.body)).action === 'preview') ? new Response(null, {status: 204})
      : Response.json({code: 'file_unavailable'}, {status: 404})
    : Response.json({platform}));
  vi.stubGlobal('fetch', fetchArtifact);
  const original = ResizeObserver;
  let reveal: (() => void) | undefined;
  vi.stubGlobal('ResizeObserver', class extends original {
    constructor(cb: ResizeObserverCallback) { super(cb); reveal = () => cb([], this); }
    override observe(node: Element) { if (node.matches('[data-panel-root]')) reveal?.(); }
  });
  const f=await setup(['attachment.list.page','artifact.list.page']);
  const at='2026-11-21T00:00:00Z';
  const version=(n:number,title:string)=>({version:n,title,uri:`/fixture/notes-${n}.md`,mime:'text/markdown',created_at:at});
  const row=(id:string,n:number,title:string)=>({artifact_id:id,thread_id:'lead',created_at:at,updated_at:at,latest:version(n,title)});
  let latest=row('z',2,'Report');
  let failed=false;
  const answer=f.db.answer.bind(f.db);
  f.db.answer=call=>{
   if(call.command==='attachment.list') return {ok:true,result:{items:[]}};
   if(failed && (call.command==='artifact.list' || call.command==='artifact.get')) return {ok:false,code:'cursor_expired',message:'Retained cut expired'};
   if(call.command==='artifact.list') return {ok:true,result:{items:[latest,row('a',1,'Diagram')]}};
   if(call.command==='artifact.get') {
    const {version:n}=call.args as {version?:number};
    const {latest:_,...identity}=latest;
    return n ? {ok:true,result:{...identity,version:version(n,'Draft')}}
     : {ok:true,result:{...latest,versions:{items:[{version:latest.latest.version,created_at:at},{version:1,created_at:at}]}}};
   }
   return answer(call);
  };
  const page=f.host.querySelector('#panel-page-possessions')!;
  const pump=async (work:()=>void)=>{ await act(async()=>work()); await act(async()=>{await settle(f.t,f.db);}); };
  try {
   expect(f.t.calls('artifact.list')).toHaveLength(0);
   await pump(()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="possessions"]')!.click());
   expect([...page.querySelectorAll('[data-panel-row-id]')].map(el=>el.getAttribute('data-panel-row-id'))).toEqual(['z','a']);
   expect(page.querySelector('[data-panel-row-id="z"]')?.textContent).toContain('v2');
   expect(page.querySelector('[data-panel-row-id="a"]')?.textContent).not.toContain('v1');
   const revealRow = page.querySelector<HTMLButtonElement>('[data-panel-row-id="z"] button[aria-label="Finderで表示"]');
   expect(!!revealRow).toBe(platform === 'finder');
   if (revealRow) {
    await pump(() => revealRow.click());
    expect(page.querySelector('[data-panel-row-id="z"] + * [role="alert"]')?.textContent).toContain('成果物のファイルが見つからない');
    const request = fetchArtifact.mock.calls.find(([path, init]) => path === '/artifact-reveal' && init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({thread_id:'lead',artifact_id:'z',version:2});
    expect(page.querySelector('[data-panel-detail]')).toBeNull();
    const selector = '[data-panel-row-id="z"] + * [data-artifact-reveal-status][role="status"]';
    const region = page.querySelector(selector);
    expect(region?.textContent).toBe('');
    expect(region?.hasAttribute('hidden')).toBe(false);
    expect(region?.hasAttribute('aria-hidden')).toBe(false);
    expect(region?.classList.contains('artifact-reveal-message')).toBe(false);
    succeeds = true;
    await pump(() => revealRow.click());
    const toast = page.querySelector(selector);
    expect(toast).toBe(region);
    expect(toast?.classList.contains('artifact-reveal-message')).toBe(true);
    expect(toast?.textContent).toBe(f.model.t.peek()('artifact.reveal.revealed'));
    expect(page.querySelector('[data-panel-row-id="z"] + * [role="alert"]')).toBeNull();
   }
   await pump(()=>page.querySelector<HTMLButtonElement>('[data-panel-row-id="z"] button')!.click());
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/notes-2.md');
   expect(!!page.querySelector('[data-panel-detail] button[aria-label="Finderで表示"]')).toBe(platform === 'finder');
   expect(page.querySelector('[data-panel-detail] button[aria-label="パスをコピー"]')).not.toBeNull();
   await pump(()=>page.querySelector<HTMLButtonElement>('[data-panel-row-id="z:v1"] button')!.click());
   expect(f.t.calls('artifact.get').at(-1)?.args).toEqual({artifact_id:'z',version:1});
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/notes-1.md');
   failed=true;
   await pump(()=>f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false}));
   expect(page.querySelector('[data-panel-row-id="z"]')?.textContent).toContain('Report');
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/notes-1.md');
   expect(f.model.artifacts.history.state.value).toMatchObject({complete:false,error:{message:'Retained cut expired'}});
   failed=false;
   latest=row('z',3,'New report');
   await pump(()=>f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false}));
   expect(f.t.calls('artifact.list')).toHaveLength(3);
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('New report');
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/notes-1.md');
  } finally {f.model.dispose();f.data.stop();vi.unstubAllGlobals();}
 });


 it('opens the attachment section on demand, pages by cursor, and refreshes on the Thread hint', async () => {
  const f=await setup(['attachment.list.page']);
  const row=(id:string,path:string)=>({attachment_id:id,source_node_id:`source-${id}`,thread_id:'lead',path,kind:'file',delivery_status:'applied',selected:true,managed:false});
  let first:{items:ReturnType<typeof row>[];next_cursor?:string}={items:[row('a','/fixture/readme.txt')],next_cursor:'opaque'};
  const answer=f.db.answer.bind(f.db);
  f.db.answer=call=>call.command==='attachment.list'
   ? {ok:true,result:(call.args as {cursor?:string}).cursor ? {items:[row('b','C:\\fixture\\notes.txt')]} : first}
   : answer(call);
  try {
   const tabs=[...f.host.querySelectorAll<HTMLButtonElement>('[role=tab]')];
   expect(tabs.map(tab=>tab.dataset.panelTab)).toEqual(['work','reply-needed','awaiting-reply','possessions','info','settings']);
   expect(f.t.calls('attachment.list')).toHaveLength(0);
   await act(async()=>{tabs[3]!.click();});
   await act(async()=>{await settle(f.t,f.db);});
   expect(f.t.calls('attachment.list').map(call=>call.args)).toEqual([{thread_id:'lead',limit:50}]);
   const page=f.host.querySelector('#panel-page-possessions')!;
   expect(page.querySelectorAll('[data-panel-row-id]')).toHaveLength(1);
   const opener=page.querySelector<HTMLButtonElement>('[data-panel-row-id="a"] button')!;
   expect(opener.textContent).toContain('readme.txt');
   await act(async()=>opener.click());
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/readme.txt');
   await act(async()=>page.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
   expect(document.activeElement).toBe(opener);
   const more=[...page.querySelectorAll('button')].find(btn=>btn.textContent==='さらに表示')!;
   await act(async()=>{more.click();await settle(f.t,f.db);});
   expect(f.t.calls('attachment.list').at(-1)?.args).toEqual({thread_id:'lead',limit:50,cursor:'opaque'});
   expect([...page.querySelectorAll('[data-panel-row-id]')].map(el=>el.textContent)).toEqual(['readme.txtファイル','notes.txtファイル']);
   await act(async()=>page.querySelector<HTMLButtonElement>('[data-panel-row-id="b"] button')!.click());
   first={items:[row('c','/fixture/new.txt')],next_cursor:'new-cut'};
   f.db.threads.lead!.state='running';
   await act(async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await flush();});
   const read=f.t.calls('attachment.list').at(-1)!;
   expect(page.querySelectorAll('[data-panel-row-id]')).toHaveLength(2);
   expect(page.querySelector('[role=status]')).toBeNull();
   expect(read.args).toEqual({thread_id:'lead',limit:50});
   await act(async()=>{
    f.db.answered.add(read.id); f.t.ok(read.id,first);
    // Reply page reads share the transport budget with the attachment continuation.
    for (const call of f.t.calls().filter(call => call.command !== 'attachment.list' && !f.db.answered.has(call.id))) {
     f.db.answered.add(call.id); const result = f.db.answer(call);
     if (result.ok) f.t.ok(call.id,result.result); else f.t.ownerError(call.id,result.code);
    }
    await flush();
   });
   expect(f.t.calls('attachment.list').at(-1)?.args).toEqual({thread_id:'lead',limit:50,cursor:'new-cut'});
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('notes.txt');
   expect(page.querySelector('[data-panel-row-id="a"]')).not.toBeNull();
   expect(page.querySelector('[data-panel-row-id="c"]')).toBeNull();
   await act(async()=>{await settle(f.t,f.db);});
   expect(page.querySelector('[data-panel-row-id="c"]')?.textContent).toContain('new.txt');
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('notes.txt');
   first={items:[]};
   await act(async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await settle(f.t,f.db);});
   expect(page.querySelector('[data-panel-row-id="b"]')).toBeNull();
   expect(page.querySelector('h3')?.textContent).toBe('添付'); // the open detail heading, not a list divider
   expect(page.querySelector('[data-panel-list] h3')).toBeNull();
   await act(async()=>page.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
   expect(document.activeElement).toBe(tabs[3]);
   await act(async()=>tabs[0]!.click());
   await act(async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await settle(f.t,f.db);});
   expect(f.t.calls('attachment.list')).toHaveLength(5);
  } finally {f.model.dispose();f.data.stop();}
 });

 it('keeps hint failures visible in detail and honors the section cursor', async () => {
  const f=await setup(['attachment.list.page']);
  const row=(id:string)=>({attachment_id:id,source_node_id:`source-${id}`,thread_id:'lead',path:`/fixture/${id}.txt`,kind:'file',delivery_status:'applied',selected:true,managed:false});
  let mode:'initial'|'unavailable'|'partial'|'expired'='initial';
  const answer=f.db.answer.bind(f.db);
  f.db.answer=call=>{
   if(call.command!=='attachment.list') return answer(call);
   const cursor=(call.args as {cursor?:string}).cursor;
   if(mode==='unavailable'||(mode==='partial'&&cursor!==undefined)) return {ok:false,code:'busy',message:'fixture read failed'};
   if(mode==='expired'&&cursor!==undefined) return {ok:false,code:'cursor_expired',message:'fixture selection revision changed'};
   if(mode==='partial'||mode==='expired') return {ok:true,result:{items:[row('replacement')],next_cursor:'replacement-cursor'}};
   return {ok:true,result:{items:[row(cursor?'second':'first')],next_cursor:cursor?'third-page':'second-page'}};
  };
  const hint=async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await settle(f.t,f.db);};
  try {
   const tab=f.host.querySelector<HTMLButtonElement>('[data-panel-tab="possessions"]')!;
   await act(async()=>tab.click());
   await act(async()=>{await settle(f.t,f.db);});
   const panel=f.host.querySelector('#panel-page-possessions')!;
   const more=()=>[...panel.querySelectorAll('button')].find(btn=>btn.textContent==='さらに表示');
   const openFirst=()=>panel.querySelector<HTMLButtonElement>('[data-panel-row-id="first"] button')!.click();
   const back=()=>panel.querySelector<HTMLButtonElement>('[data-panel-back]')!.click();
   await act(async()=>openFirst());
   mode='unavailable';
   await act(hint);
   expect(panel.querySelector('[data-panel-detail] [role="alert"]')?.textContent).toBe('添付を読み込めませんでした');
   expect(panel.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/first.txt');
   expect(f.t.calls('attachment.list')).toHaveLength(2);
   await act(async()=>back());
   expect(panel.querySelector('[data-panel-list] [role="alert"]')?.textContent).toBe('添付を読み込めませんでした');
   expect(more()?.disabled).toBe(false);
   mode='initial';
   await act(async()=>{more()!.click();await settle(f.t,f.db);});
   expect(f.t.calls('attachment.list').at(-1)?.args).toEqual({thread_id:'lead',limit:50,cursor:'second-page'});
   mode='partial';
   await act(hint);
   expect(f.t.calls('attachment.list')).toHaveLength(5);
   expect(f.model.attachmentSection.state.peek().cursor).toBe('third-page');
   expect(more()?.disabled).toBe(false);
   expect(panel.querySelector('[data-panel-row-id="second"]')).not.toBeNull();
   expect(panel.querySelector('[data-panel-row-id="replacement"]')).toBeNull();
   mode='expired';
   await act(hint);
   expect(f.t.calls('attachment.list')).toHaveLength(7);
   expect(f.model.attachmentSection.state.peek().cursor).toBeUndefined();
   expect(more()).toBeUndefined();
   expect(panel.querySelector('[data-panel-row-id="second"]')).not.toBeNull();
   expect(panel.querySelector('[data-panel-row-id="replacement"]')).toBeNull();
  } finally {f.model.dispose();f.data.stop();}
 });

 it('rejects the legacy array and shows an attachment read error', async () => {
  const f=await setup(['attachment.list.page']);
  const answer=f.db.answer.bind(f.db);
  f.db.answer=call=>call.command==='attachment.list'?{ok:true,result:[]}:answer(call);
  try {
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="possessions"]')!.click());
   await act(async()=>{await settle(f.t,f.db);});
   const page=f.host.querySelector('#panel-page-possessions')!;
   expect(page.querySelector('[role="alert"]')?.textContent).toContain('添付を読み込めませんでした');
   expect(page.querySelectorAll('[data-panel-row-id]')).toHaveLength(0);
  } finally {f.model.dispose();f.data.stop();}
 });

 it('shows the fixed tabs and splits replies by recipient kind',async()=>{
  const f=await setup();
  try{
   const tabs=[...f.host.querySelectorAll<HTMLButtonElement>('[role=tab]')];
   expect(tabs.map(tab=>tab.getAttribute('aria-label'))).toEqual(['動作 1','要返信 1','返信待ち 1','分析','設定']);
   await act(async()=>{tabs[0]!.focus();tabs[0]!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});
   expect(f.model.panelTab.peek()).toBe('reply-needed');
   expect(f.host.querySelectorAll('section[role=tabpanel]:not([hidden])')).toHaveLength(1);
   const owed=f.host.querySelector<HTMLButtonElement>('[data-panel-tab="reply-needed"]')!;
   await act(async()=>owed.click());
   expect(f.host.querySelector('section[role=tabpanel]:not([hidden]) [data-panel-row-id="asked-child"]')).not.toBeNull();
   expect(f.host.querySelector('section[role=tabpanel]:not([hidden]) [data-panel-row-id="owed-human"]')).toBeNull();
   const waiting=f.host.querySelector<HTMLButtonElement>('[data-panel-tab="awaiting-reply"]')!;
   await act(async()=>waiting.click());
   expect(f.host.querySelector('section[role=tabpanel]:not([hidden]) [data-panel-row-id="owed-human"]')).not.toBeNull();
   expect(f.host.querySelector('section[role=tabpanel]:not([hidden]) [data-panel-row-id="asked-child"]')).toBeNull();
   await act(async()=>{tabs[3]!.click();});
   const info=f.host.querySelector('#panel-page-info:not([hidden])')!;
   const values=['model-a','high','test-connection','/fixture/panel'];
   for(const value of values) expect(info.textContent).not.toContain(value);
   await act(async()=>{tabs[4]!.click();});
   const settings=f.host.querySelector('#panel-page-settings:not([hidden])')!;
   for(const value of values) expect(settings.textContent).toContain(value);
  }finally{f.model.dispose();f.data.stop();}
 });

 it('puts the issued description before the command and falls back to command alone',async()=>{
  const f=await setup();
  try {
   const row=()=>f.host.querySelector('[data-panel-row-id="shell-running"]')!;
   const titles=()=>[...row().querySelectorAll('.panel-list-title')].map(node=>node.textContent);
   const heading=()=>f.host.querySelector('[data-panel-detail] .cmd')!;
   expect(titles()).toEqual(['Current verification','npm test']);
   await act(async()=>row().querySelector('button')!.click());
   expect(heading().textContent).toBe('Current verificationnpm test');
   expect(heading().querySelector('.mono.caption')?.textContent).toBe('npm test');
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
   f.db.shells.lead=[{execution_id:'shell-running',state:'running',command_excerpt:'npm test'}];
   await act(async()=>{f.t.push({t:'changed',thread_ids:['lead'],list:false,config_changed:false});await settle(f.t,f.db);});
   expect(titles()).toEqual(['npm test']);
   await act(async()=>row().querySelector('button')!.click());
   expect(heading().textContent).toBe('npm test');
   expect(heading().querySelector('.mono.caption')).toBeNull();
  }finally{f.model.dispose();f.data.stop();}
 });

 it('keeps the Activity elapsed time following the clock (#171)',async()=>{
  const f=await setup();
  try{
   const subtitle=()=>f.host.querySelector('[data-panel-list="work"] [data-panel-row-id="shell-running"] .panel-list-subtitle')?.textContent;
   act(()=>{f.model.now.value=Date.parse('2026-11-21T00:00:05Z');});
   const first=subtitle();
   expect(first).toBeTruthy();
   // Witness for the rest of the panel: change the row's saved label behind the signals' back. Only a
   // render of the whole Activity list would show it, and a tick of the clock must not cause one.
   const title=()=>f.host.querySelector('[data-panel-list="work"] [data-panel-row-id="shell-running"] .panel-list-title')?.textContent;
   const shown=title();
   const row=f.model.work.peek().running.find(item=>item.id==='shell-running')! as {label:string};
   row.label='Unannounced label';
   act(()=>{f.model.now.value+=60_000;});
   expect(subtitle()).toBeTruthy();
   expect(subtitle()).not.toBe(first);
   expect(title()).toBe(shown);
  }finally{f.model.dispose();f.data.stop();}
 });

 it('opens an action detail from its row and returns with list scroll and selection intact; Escape also returns',async()=>{
  const f=await setup();
  try{
   const list=f.host.querySelector<HTMLElement>('[data-panel-list="work"]')!;expect(list).not.toBeNull();
   list.scrollTop=84;
   const row=f.host.querySelector<HTMLElement>('[data-panel-row-id="shell-running"]')!;expect(row).not.toBeNull();
   await act(async()=>row.querySelector<HTMLButtonElement>('button')!.click());
   expect(f.model.selectedStepId.peek()).toBe('shell-running');
   expect(f.host.querySelector('#panel-page-work:not([hidden]) [data-panel-detail]')?.textContent).toContain('npm test');
   const back=f.host.querySelector<HTMLButtonElement>('[data-panel-back]')!;
   expect(back.textContent).toBe('動作');
   expect(back.getAttribute('aria-label')).toBe('動作に戻る');
   await act(async()=>back.click());
   expect(f.host.querySelector('[data-panel-list="work"]')).toBe(list);
   expect(list.scrollTop).toBe(84);
   expect(f.host.querySelector('section[role=tabpanel]:not([hidden]) [data-panel-row-id="shell-running"]')?.getAttribute('aria-current')).toBe('true');
   await act(async()=>row.querySelector<HTMLButtonElement>('button')!.click());
   await act(async()=>{f.host.querySelector('[data-panel-back]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
   expect(f.host.querySelector('[data-panel-detail]')).toBeNull();
  }finally{f.model.dispose();f.data.stop();}
 });

 it('retains the human question opener after Back on desktop', async () => {
  const f=await setup();
  try {
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="awaiting-reply"]')!.click());
   const panel=f.host.querySelector('#panel-page-awaiting-reply')!;
   const row=panel.querySelector('[data-panel-row-id="owed-human"]')!;
   expect(row.getAttribute('data-waiting')).toBe('true');
   expect(row.textContent).toContain('2.4s');
   await act(async()=>row.querySelector('button')!.click());
   expect(panel.querySelector('[data-panel-detail] textarea')).not.toBeNull();
   expect(panel.querySelector('[data-panel-back]')?.textContent).toBe('返信待ち');
   await act(async()=>panel.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
   expect(row.getAttribute('aria-current')).toBe('true');
   expect(document.activeElement).toBe(row.querySelector('button'));
  } finally {f.model.dispose();f.data.stop();}
 });

 it('opens a collapsed panel via the model action and keeps one target operation across Back', async () => {
  const f=await setup();
  try {
   await act(async()=>f.model.togglePanel());
   expect(f.prefs.value.panelCollapsed).toBe(true);
   await act(async()=>f.model.openInPanel({kind:'step',id:'shell-running'}));
   expect(f.prefs.value.panelCollapsed).toBe(false);
   expect(loadPrefs(f.store,DESIGNS).panelCollapsed).toBe(false);
   expect(f.host.querySelector('#panel-page-work [data-panel-detail]')?.textContent).toContain('npm test');
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-tab="awaiting-reply"]')!.click());
   const row=f.host.querySelector('[data-panel-row-id="owed-human"]')!;
   await act(async()=>row.querySelector('button')!.click());
   let operation: Promise<void> | undefined;
   await act(async()=>{operation=f.model.runPanelOperation('owed-human',{kind:'cancel',target:'reply'});});
   const call=f.t.calls('message.cancel')[0]!;
   expect(f.model.panelOperations.peek().get('owed-human')?.disposition).toBe("pending");
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
   await act(async()=>{void f.model.runPanelOperation('owed-human',{kind:'cancel',target:'reply'});});
   expect(f.t.calls('message.cancel')).toHaveLength(1);
   await act(async()=>{f.db.answered.add(call.id); f.t.ownerError(call.id,'synthetic','fixture cancellation failed'); await operation;});
   expect(f.host.querySelector('#panel-page-awaiting-reply [role=alert]')?.textContent).toContain('fixture cancellation failed');
   await act(async()=>row.querySelector('button')!.click());
   expect(f.host.querySelector('[data-panel-detail] [role=alert]')?.textContent).toContain('fixture cancellation failed');
  } finally {f.model.dispose();f.data.stop();}
 });

 it.each([390, 1179])('opens Activity details and shares the panel toggle with Alt+9 at %ipx', async width => {
  const f=await setup();
  const shortcut=()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'9',code:'Digit9',altKey:true,bubbles:true,cancelable:true}));
  const sheet=()=>f.host.querySelector<HTMLDialogElement>('dialog.work-sheet[open]');
  const toggle=()=>f.host.querySelector<HTMLButtonElement>('.phone-panel-footer .shell-toggle-panel')!;
  try {
   await act(async()=>f.model.togglePanel());
   const stored=f.stored.value;
   Object.defineProperty(f.host.querySelector('.app'), 'clientWidth', {configurable:true,value:width});
   f.db.bodies.queued='Queued fixture message';
   f.db.work.lead!.push({kind:'message',id:'queued',thread_id:'lead',message_id:'queued',state:'held'});
   await act(async()=>{f.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false});await settle(f.t,f.db);});
   await act(async()=>{shortcut();});
   expect(sheet()?.querySelector('[data-phone-panel]')).not.toBeNull();
   for (const [id, expected] of [['shell-running','npm test'],['queued','Queued fixture message']]) {
    const opener=sheet()!.querySelector<HTMLButtonElement>(`[data-panel-row-id="${id}"] .panel-list-main`)!;
    await act(async()=>{opener.click();await settle(f.t,f.db);});
    expect(sheet()?.querySelector('[data-panel-detail]')?.textContent).toContain(expected);
    await act(async()=>sheet()!.querySelector<HTMLButtonElement>('[data-panel-back]')!.click());
    expect(document.activeElement).toBe(opener);
   }
   await act(async()=>{shortcut();});
   expect(sheet()).not.toBeNull();
   await act(async()=>sheet()!.querySelector<HTMLButtonElement>('.work-sheet-head button')!.click());
   expect(sheet()).toBeNull();
   expect(document.activeElement).toBe(toggle());
   await act(async()=>toggle().click());
   expect(sheet()).not.toBeNull();
   await act(async()=>sheet()!.querySelector<HTMLButtonElement>('.work-sheet-head button')!.click());
   expect(sheet()).toBeNull();
   expect(f.stored.value).toBe(stored);
   expect(f.prefs.value.panelCollapsed).toBe(true);
  } finally {f.model.dispose();f.data.stop();}
 });

 it('leaves the desktop preference untouched for step activation below 1180px', async () => {
  const f=await setup();
  try {
   await act(async()=>f.model.togglePanel());
   const saved=f.stored.value;
   const app=f.host.querySelector('.app');
   for (const width of [390,1179]) {
    Object.defineProperty(app,'clientWidth',{configurable:true,value:width});
    await act(async()=>f.model.openInPanel({kind:'step',id:'shell-running'}));
    expect(f.model.panelDetail.peek()).toBeUndefined();
    expect(f.prefs.value.panelCollapsed).toBe(true);
    expect(f.stored.value).toBe(saved);
   }
   Object.defineProperty(app,'clientWidth',{configurable:true,value:1180});
   await act(async()=>f.model.openInPanel({kind:'step',id:'shell-running'}));
   expect(f.model.panelDetail.peek()?.id).toBe('shell-running');
   expect(loadPrefs(f.store,DESIGNS).panelCollapsed).toBe(false);
  } finally {f.model.dispose();f.data.stop();}
 });

 it.each([['pending','changed'],['pending','absent'],['reply','absent']] as const)('settles a successful %s cancellation on fresh %s evidence', async (source, evidence) => {
  const f=await setup();
  try {
   const id=source==='pending'?'queued':'owed-human';
   const update=async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await settle(f.t,f.db);};
   if (source==='pending') {
    f.db.work.lead!.push({kind:'message',id,thread_id:'lead',message_id:id,state:'accepted',excerpt:'Queued'});
    await act(update);
   }
   let operation!: Promise<void>;
   await act(async()=>{operation=f.model.runPanelOperation(id,{kind:'cancel',target:source});await flush();});
   const call=f.t.calls('message.cancel')[0]!;
   expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
   const reads=()=>f.t.calls('status').length+f.t.calls('thread.get').length+f.t.calls('message.list').length;
   const before=reads();
   await act(async()=>{f.db.answered.add(call.id);f.t.ok(call.id,{items:[{message_id:id,outcome:source==='reply'?'reply_cancelled':'cancelled'}]});await operation;});
   expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
   expect(reads()).toBe(before);
   await act(update);
   expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
   if (source==='pending') {
    const others=Array.from({length:201},(_,i)=>({kind:'shell',id:`other-${i}`,thread_id:'lead',execution_id:`other-${i}`,run_id:'run-1',state:'running'}));
    const target=f.db.work.lead!.find(row=>row.message_id===id)!;
    f.db.work.lead=[...others,target];
    await act(update);
    expect(f.model.handle.peek()?.work.peek().value?.next_cursor).toBeDefined();
    expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
    f.db.work.lead=[target,...others];
    await act(update);
    expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
    await act(async()=>{await f.model.runPanelOperation(id,{kind:'cancel',target:source});});
    expect(f.t.calls('message.cancel')).toHaveLength(1);
    f.db.work.lead=evidence==='changed'?[{...target,state:'held'},...others]:[];
   } else {
    f.db.replies=Array.from({length:17},(_,i)=>pendingReply(`other-${i}`, "lead", {kind:"name",name:"human"}, "Other question"));
    await act(update);
    expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
    f.db.replies=f.db.replies.slice(0,16);
   }
   await act(async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await flush();});
   expect(reads()).toBeGreaterThan(before);
   expect(f.model.panelOperations.peek().get(id)?.disposition).toBe("pending");
   await act(async()=>{await settle(f.t,f.db);});
   expect(f.model.panelOperations.peek().has(id)).toBe(false);
   if (evidence==='changed') expect(f.model.handle.peek()?.work.peek().value?.next_cursor).toBeDefined();
   expect(f.t.calls('message.cancel')).toHaveLength(1);
  } finally {f.model.dispose();f.data.stop();}
 });

 it.each(['current','left'] as const)('publishes unconfirmed cancellation only for the %s Thread lifetime', async lifetime => {
  const f=await setup();
  const error = { kind: 'unconfirmed', operationId: 'original-cancel', message: 'Unconfirmed' } as const;
  let finish!: () => void;
  const cancel=vi.spyOn(f.model.ops,'messageCancel').mockImplementation(() => new Promise(resolve => { finish=()=>resolve({ok:false,error}); }));
  try {
   let operation!: Promise<void>;
   await act(async()=>{operation=f.model.runPanelOperation('owed-human',{kind:'cancel',target:'reply'});await flush();});
   expect(f.model.panelOperations.peek().get('owed-human')?.disposition).toBe('pending');
   if (lifetime==='left') {
    f.db.threads.other=summary('other'); f.db.details.other=details('other');
    await act(async()=>{f.model.openThread('other');await settle(f.t,f.db);});
    expect(f.model.panelOperations.peek().size).toBe(0);
   }
   await act(async()=>{finish();await operation;});
   if (lifetime==='left') expect(f.model.panelOperations.peek().size).toBe(0);
   else {
    expect(f.model.panelOperations.peek().get('owed-human')).toMatchObject({disposition:'unconfirmed'});
    await act(async()=>{await f.model.runPanelOperation('owed-human',{kind:'cancel',target:'reply'});});
    expect(cancel).toHaveBeenCalledTimes(1);
   }
  } finally {cancel.mockRestore();f.model.dispose();f.data.stop();}
 });

 it('Alt+9 collapses to a counted icon rail and restores the stored state after remount',async()=>{
  const f=await setup();
  try{
   await act(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'9',code:'Digit9',altKey:true,bubbles:true,cancelable:true}));});
   expect(f.prefs.value.panelCollapsed).toBe(true);
   expect(f.host.querySelector('[data-panel-rail]')).not.toBeNull();
   expect(f.host.querySelectorAll('[data-panel-rail] [role=tab]')).toHaveLength(5);
   const action=f.host.querySelector<HTMLButtonElement>('[data-panel-rail] [data-panel-tab="work"]')!;
   const tip=f.host.querySelector(`[id="${action.getAttribute('aria-describedby')}"]`);
   expect(tip?.getAttribute('role')).toBe('tooltip');
   await act(async()=>{action.focus();action.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));});
   expect(document.activeElement?.getAttribute('data-panel-tab')).toBe('reply-needed');
   expect(f.model.panelTab.peek()).toBe('work');
   expect(f.prefs.value.panelCollapsed).toBe(true);
   const saved=f.stored.value;
   render(null,f.host);
   const prefs=signal<Prefs>(loadPrefs(f.store,DESIGNS));
   const context:DesignContext={model:f.model,prefs,setPrefs:change=>{prefs.value={...prefs.value,...change};savePrefs(f.store,prefs.value);},designs:DESIGNS,submitToken:async()=>false};
   await act(async()=>render(<App context={context}/>,f.host!));
   Object.defineProperty(f.host.querySelector(".app"), "clientWidth", { configurable:true, value:1280 });
   expect(prefs.value.panelCollapsed).toBe(true);expect(f.stored.value).toBe(saved);
   await act(async()=>f.host.querySelector<HTMLButtonElement>('[data-panel-rail] [data-panel-tab="awaiting-reply"]')!.click());
   expect(prefs.value.panelCollapsed).toBe(false);
   expect(f.model.panelTab.peek()).toBe('awaiting-reply');
  }finally{f.model.dispose();f.data.stop();}
 });
});


it('does not route global shortcuts from Japanese IME, editors, or handled events', async () => {
 const f = await setup();
 const key = (target: EventTarget, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: '5', code: 'Digit5', altKey: true, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
 };
 try {
  expect(key(window, { isComposing: true }).defaultPrevented).toBe(false);
  expect(f.model.route.peek().view).toBe('conversation');
  const editor = f.host.querySelector<HTMLTextAreaElement>('#composer')!;
  editor.focus();
  expect(key(editor).defaultPrevented).toBe(false);
  expect(f.model.route.peek().view).toBe('conversation');
  editor.blur();
  const handled = new KeyboardEvent('keydown', { key: '5', code: 'Digit5', altKey: true, cancelable: true });
  handled.preventDefault();
  window.dispatchEvent(handled);
  expect(f.model.route.peek().view).toBe('conversation');
  await act(async () => { expect(key(window).defaultPrevented).toBe(true); });
  expect(f.model.route.peek().view).toBe('settings');
 } finally { f.model.dispose(); f.data.stop(); }
});
