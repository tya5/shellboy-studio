// @vitest-environment happy-dom
import { render } from 'preact';
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

});
