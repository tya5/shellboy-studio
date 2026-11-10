// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
// Normalized presentation scaffold only. This is NOT a Core #296 wire DTO.
interface Item { key:string; nodeId:string; kind:'text'|'tool'; text:string }
let host:HTMLDivElement|undefined;
afterEach(()=>{if(host){render(null,host);host.remove();host=undefined;}});
async function renderer(){
  // The missing item renderer is the first red milestone, not a live-wire observation.
  const path='../screens/ConversationItems';
  const module=await import(path);
  return module.ConversationItems;
}
const item=(key:string,nodeId:string,kind:'text'|'tool'):Item=>({key,nodeId,kind,text:`Synthetic ${key}`});
describe('flat authoritative output-item DOM contract (normalized scaffold)',()=>{
  it.each([
    ['A',[item('A:0','A','text'),item('A:1','A','tool')]],
    ['B',[item('B:0','B','tool'),item('B:1','B','text'),item('B:2','B','tool')]],
  ] as const)('%s output siblings share one parent; heading never owns items',async(_name,items)=>{
    const Items=await renderer();host=document.createElement('div');document.body.append(host);
    await act(async()=>render(<Items items={items} heading="Synthetic heading" />,host!));
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
    await act(async()=>render(<Items items={first} heading="Before" />,host!));
    const old=host.querySelector('[data-item-key="A:1"]')!,parent=old.parentElement;
    await act(async()=>render(<Items items={[{...first[0]!,text:'Updated synthetic body'},first[1]!,item('B:0','B','tool')]} heading="After" />,host!));
    expect(host.querySelector('[data-item-key="A:1"]')).toBe(old);expect(old.parentElement).toBe(parent);
    expect(host.querySelector('[data-node-container]')).toBeNull();
  });
});
