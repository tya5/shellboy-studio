// @vitest-environment happy-dom
import { render } from 'preact';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { Output } from '../screens/Conversation';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
// Normalized presentation scaffold only. This is NOT a Core #296 wire DTO.
interface Item { key:string; source:{nodeId:string;itemIdentity:string;revision:string;kind:'text'|'tool';text:string;executionId?:string} }
let host:HTMLDivElement|undefined;
afterEach(()=>{if(host){render(null,host);host.remove();host=undefined;}});
async function renderer(){
  // The missing item renderer is the first red milestone, not a live-wire observation.
  const path='../screens/ConversationItems';
  const module=await import(path);
  return module.ConversationItems;
}
const item=(key:string,nodeId:string,kind:'text'|'tool'):Item=>({key,source:{nodeId,itemIdentity:key,revision:'r1',kind,text:`Synthetic ${key}`,...(kind==='tool'?{executionId:`exec-${key}`}:{})}});
describe('flat authoritative output-item DOM contract (normalized scaffold)',()=>{
  it.each([
    ['A',[item('A:0','A','text'),item('A:1','A','tool')]],
    ['B',[item('B:0','B','tool'),item('B:1','B','text'),item('B:2','B','tool')]],
  ] as const)('%s output siblings share one parent; heading never owns items',async(_name,items)=>{
    const Items=await renderer();host=document.createElement('div');document.body.append(host);
    await act(async()=>render(<Items items={items} toolSummaries={[{anchorKey:"summary",memberKeys:items.filter(i=>i.source.kind==="tool").map(i=>i.key),executionIds:[]}]} renderItem={(i:Item)=>i.source.text} renderHeading={()=>"Synthetic heading"} />,host!));
    const nodes=[...host.querySelectorAll<HTMLElement>('[data-item-key]')];
    expect(nodes.map(n=>n.dataset.itemKey)).toEqual(items.map(i=>i.key));
    expect(new Set(nodes.map(n=>n.parentElement)).size).toBe(1);
    expect(host.querySelector('[data-node-container]')).toBeNull();
    const heading=host.querySelector('[data-item-heading]');expect(heading).not.toBeNull();
    expect(nodes.every(n=>!heading!.contains(n))).toBe(true);
  });
  it('keeps surviving authoritative item DOM and parent across normalized updates',async()=>{
    const Items=await renderer();host=document.createElement('div');document.body.append(host);
    const first=[item('A:0','A','text'),item('A:1','A','tool')];
    await act(async()=>render(<Items items={first} renderItem={(i:Item)=>i.source.text} />,host!));
    const old=host.querySelector('[data-item-key="A:1"]')!,parent=old.parentElement;
    await act(async()=>render(<Items items={[{...first[0]!,source:{...first[0]!.source,text:'Updated synthetic body',revision:'r2'}},first[1]!,item('B:0','B','tool')]} renderItem={(i:Item)=>i.source.text} />,host!));
    expect(host.querySelector('[data-item-key="A:1"]')).toBe(old);expect(old.parentElement).toBe(parent);
    expect(host.querySelector('[data-node-container]')).toBeNull();
  });
  it('keeps content identity when preceding tools change summary membership and chrome keys',async()=>{
    const Items=await renderer();host=document.createElement('div');document.body.append(host);
    const a=item('A:1','A','tool'),b=item('B:0','B','tool');
    const paint=async(items:Item[],anchorKey:string)=>act(async()=>render(<Items items={items}
      toolSummaries={[{anchorKey,memberKeys:items.map(i=>i.key),executionIds:[]}]} renderHeading={()=>"Tools"} renderItem={(i:Item)=>i.source.text}/>,host!));
    await paint([a,b],'old-summary');const old=host.querySelector('[data-item-key="B:0"]')!,parent=old.parentElement;
    await paint([item('preceding','P','tool'),a,b],'merged-summary');
    expect(host.querySelector('[data-item-key="B:0"]')).toBe(old);expect(old.parentElement).toBe(parent);
    await paint([b],'split-summary');expect(host.querySelector('[data-item-key="B:0"]')).toBe(old);
    expect(old.parentElement).toBe(parent);expect(host.querySelector('[data-node-container]')).toBeNull();
    expect(old.getAttribute('data-node')).toBe('B');expect(old.getAttribute('data-execution-id')).toBe('exec-B:0');
  });

  it('asserts every mixed/cross-node item position and preserves selection through prepend/merge/split',async()=>{
    const Items=await renderer();host=document.createElement('div');document.body.append(host);
    const a=[item('A:0','A','text'),item('A:1','A','tool')],b=[item('B:0','B','tool'),item('B:1','B','text'),item('B:2','B','tool')];
    const paint=async(items:Item[],anchorKey:string)=>act(async()=>render(<Items items={items}
      toolSummaries={[{anchorKey,memberKeys:items.filter(i=>i.source.kind==='tool').map(i=>i.key),executionIds:[]}]} renderHeading={()=>'Tools'} renderItem={(i:Item)=><span>{i.source.text}</span>}/>,host!));
    const assertOrder=(items:Item[])=>expect([...host!.querySelectorAll('[data-item-key]')].map(n=>n.getAttribute('data-item-key'))).toEqual(items.map(i=>i.key));
    await paint([...a,...b],'initial');assertOrder([...a,...b]);
    const selected=host.querySelector('[data-item-key="B:1"] span')!.firstChild!;
    const selection=window.getSelection()!;const range=document.createRange();range.setStart(selected,0);range.setEnd(selected,9);selection.removeAllRanges();selection.addRange(range);
    const text=selection.toString();const parent=selected.parentNode;
    for(const [items,key] of [[[item('P:0','P','tool'),...a,...b],'prepend'],[[...a,...b],'merge'],[b,'split']] as const){
      await paint([...items],key);assertOrder([...items]);
      expect(selection.anchorNode).toBe(selected);expect(selection.toString()).toBe(text);expect(selected.parentNode).toBe(parent);
    }
    selection.removeAllRanges();
  });

  it('retains an existing empty execution output DOM/cache entry while summary chrome changes',async()=>{
    const Items=await renderer();const fixture=await fixtureModel();host=document.createElement('div');document.body.append(host);
    const cached={text:'',loading:false,cutOff:false,error:undefined};fixture.model.outputs.value=new Map([['exec-A:1',cached]]);
    const tools=[item('A:1','A','tool')];
    const paint=async(anchorKey:string)=>act(async()=>render(<Items items={tools} toolSummaries={[{anchorKey,memberKeys:['A:1'],executionIds:['exec-A:1']}]} renderHeading={()=>'Tools'} renderItem={()=><Output model={fixture.model} id="exec-A:1" command="" complete/>}/>,host!));
    try{
      await paint('before');const body=host.querySelector('[data-item-key]')!,output=host.querySelector('.log')!;
      expect(output.textContent).toBe(fixture.model.t.value('details.outputEmpty'));
      await paint('after');expect(host.querySelector('[data-item-key]')).toBe(body);expect(host.querySelector('.log')).toBe(output);
      expect(fixture.model.outputs.value.get('exec-A:1')).toBe(cached);expect(host.textContent).not.toContain(fixture.model.t.value('details.outputLoading'));
    }finally{fixture.model.dispose();fixture.data.stop();}
  });

});
