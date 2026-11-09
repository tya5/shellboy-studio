// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import type { Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { App } from '../screens/App';
let host:HTMLElement|undefined,cleanup:(()=>void)|undefined;
afterEach(()=>{if(host)render(null,host);host?.remove();host=undefined;cleanup?.();cleanup=undefined;});
async function rig(){
  const r=await fixtureModel({configure(db){
    const node=(id:string,sender:unknown)=>({node_id:id,kind:'user',excerpt:`body-${id}`,provenance:{sender:sender as {kind:string}}});
    db.history.lead=[node('one',{kind:'model',thread_id:'sender-one',label:'<img src=x onerror=alert(1)>'}),node('two',{kind:'model',thread_id:'sender-two'}),node('unknown',{kind:'model',thread_id:null,label:'Claimed'}),node('human',{kind:'human'}),node('cli',{kind:'external_cli'})];
    for(const id of ['sender-one','sender-two'])db.threads[id]={...db.threads.lead!,thread_id:id,title:'<Same current title>'};
  }});
  host=document.createElement('div');document.body.append(host);cleanup=()=>r.model.dispose();
  const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',weights:{cached:.1,output:5}});
  await act(async()=>{render(<App context={{model:r.model,prefs,designs:DESIGNS,setPrefs(){},submitToken:async()=>true}}/>,host!);await settle(r.t,r.db);});
  return {...r,host:host!};
}
describe('sender facts in the existing conversation',()=>{
  it('keeps full ID distinct under same-title senders and escapes self-asserted labels/title',async()=>{
    const r=await rig();const boxes=r.host.querySelectorAll('.sender-fact');expect(boxes).toHaveLength(2);
    expect(boxes[0]!.textContent).toContain('Current title: <Same current title>');expect(boxes[1]!.textContent).toContain('sender-two');
    expect(boxes[0]!.textContent).toContain('sender-one');expect(boxes[0]!.textContent).toContain('Self-asserted label: <img src=x onerror=alert(1)>');
    expect(boxes[1]!.textContent).not.toContain('Self-asserted label:');expect(boxes[0]!.querySelector('img')).toBeNull();
    expect(boxes[0]!.querySelector('a')!.getAttribute('href')).toContain('sender-one');
  });
  it('does not call malformed model identity You or invent a sender ID for CLI/human',async()=>{
    const r=await rig();const messages=[...r.host.querySelectorAll('.msg')];const unknown=messages.find(e=>e.textContent?.includes('body-unknown'))!;
    expect(unknown.textContent).toContain('Model sender (identity unavailable)');expect(unknown.querySelector('.who')!.textContent).not.toBe('You');
    for(const id of ['human','cli'])expect(messages.find(e=>e.textContent?.includes(`body-${id}`))!.querySelector('.sender-fact')).toBeNull();
  });
});
