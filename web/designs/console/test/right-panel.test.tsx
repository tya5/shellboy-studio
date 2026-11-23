import { pendingReply } from "../../../data/test/harness";
// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { details, summary, settle, flush } from '../../../data/test/harness';
import type { DesignContext, Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { loadPrefs, savePrefs, type PrefStore } from '../../../ui-core/src/prefs';
import { App } from '../screens/App';

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
   await act(async()=>{await settle(f.t,f.db);});
   expect(row()).toBeNull();
   expect(count()).toBeUndefined();
   expect(activity()).toContain(text('panel.empty.work'));
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

 it('keeps non-human asked-by rows linked in the narrow work sheet', async () => {
  const f=await setup();
  try {
   f.db.replies=[f.db.replies[0]!,pendingReply("asked-child","lead",{kind:"thread",thread_id:"child"},"Waiting for the child Thread")];
   await act(async()=>{f.t.push({t:"changed",config_changed:false,thread_ids:["lead"],list:false});await settle(f.t,f.db);});
   Object.defineProperty(f.host.querySelector(".app"), "clientWidth", { configurable:true, value:390 });
   const strip=[...f.host.querySelectorAll('button')].find(button=>button.textContent?.includes('返信'))!;
   await act(async()=>strip.click());
   await act(async()=>{await settle(f.t,f.db);});
   const sheet=f.host.querySelector<HTMLDialogElement>('.work-sheet')!;
   expect(sheet.open).toBe(true);
   expect(sheet.querySelector('textarea')).not.toBeNull();
   const link=[...sheet.querySelectorAll<HTMLAnchorElement>('.work-row a')].find(anchor=>anchor.textContent==='child');
   expect(link?.getAttribute('href')).toContain('child');
   expect(sheet.querySelectorAll('.work-row a')).toHaveLength(1);
  } finally {f.model.dispose();f.data.stop();}
 });

 it('keeps artifact owner order and refreshes both list and detail on the Thread hint', async () => {
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
   await pump(()=>page.querySelector<HTMLButtonElement>('[data-panel-row-id="z"] button')!.click());
   expect(page.querySelector('[data-panel-detail]')?.textContent).toContain('/fixture/notes-2.md');
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
   await act(async()=>{f.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await flush();});
   const read=f.t.calls('attachment.list').at(-1)!;
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

 it('opens an action detail from its row and returns with list scroll and selection intact; Escape also returns',async()=>{
  const f=await setup();
  try{
   const list=f.host.querySelector<HTMLElement>('[data-panel-list="work"]')!;expect(list).not.toBeNull();
   list.scrollTop=84;
   const row=f.host.querySelector<HTMLElement>('[data-panel-row-id="shell-running"]')!;expect(row).not.toBeNull();
   await act(async()=>row.querySelector<HTMLButtonElement>('button')!.click());
   expect(f.model.selectedStepId.peek()).toBe('shell-running');
   expect(f.host.querySelector('#panel-page-work:not([hidden]) [data-panel-detail]')?.textContent).toContain('npm test');
   expect(f.host.querySelector('[data-panel-back]')?.textContent).toBe('動作');
   const back=f.host.querySelector<HTMLButtonElement>('[data-panel-back]')!;
   await act(async()=>back.click());
   expect(f.host.querySelector('[data-panel-list="work"]')).toBe(list);
   expect(list.scrollTop).toBe(84);
   expect(f.host.querySelector('section[role=tabpanel]:not([hidden]) [data-panel-row-id="shell-running"]')?.getAttribute('aria-current')).toBe('true');
   await act(async()=>row.querySelector<HTMLButtonElement>('button')!.click());
   await act(async()=>{f.host.querySelector('[data-panel-back]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
   expect(f.host.querySelector('[data-panel-detail]')).toBeNull();
  }finally{f.model.dispose();f.data.stop();}
 });

 it('retains the human question opener after Back and leaves Alt+9 inactive at sheet width', async () => {
  const f=await setup();
  try {
   Object.defineProperty(f.host.querySelector('.app'), 'clientWidth', {configurable:true,value:1179});
   await act(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'9',altKey:true,bubbles:true,cancelable:true}));});
   expect(f.prefs.value.panelCollapsed).toBe(false);
   Object.defineProperty(f.host.querySelector('.app'), 'clientWidth', {configurable:true,value:1280});
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
   await act(async()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'9',altKey:true,bubbles:true,cancelable:true}));});
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
