import { expect, it } from "vitest";
import { projectSavedItems } from "../src/conversation-items";
import { completeDisplayedOwnUserIds } from "../src/own-send-presentation";

for (const complete of [true, false, undefined]) for (const current of [true, false])
  it(`requires explicit complete visible canonical user: complete=${complete} current=${current}`, () => {
    const projection = projectSavedItems([{windowRevision:1,nodeId:"own",itemIdentity:"item",kind:"user",text:"Canonical authorized text",...(complete === undefined ? {} : {textComplete:complete})}]);
    const input={ref:{},scope:"scope",current,projection,localRows:[],hiddenItemKeys:new Set<string>(),reservation:{token:{},observation:{installedToken:{},ref:{},scope:'scope',boundary:{kind:'beginning' as const},isCurrent:()=>true}}};
    expect([...completeDisplayedOwnUserIds(input)]).toEqual(complete === true && current ? ["own"] : []);
    expect([...completeDisplayedOwnUserIds({...input,hiddenItemKeys:new Set([projection.items[0]!.key])})]).toEqual([]);
    expect([...completeDisplayedOwnUserIds({...input,projection:projectSavedItems([])})]).toEqual([]);
  });
it("does not accept metadata, empty or assistant text as an own replacement",()=>{
  const projection=projectSavedItems([
    {windowRevision:1,nodeId:"metadata",itemIdentity:"m",kind:"unavailable"},
    {windowRevision:1,nodeId:"empty",itemIdentity:"e",kind:"user",text:"",textComplete:true},
    {windowRevision:1,nodeId:"assistant",itemIdentity:"a",kind:"text",text:"Not an own user row",textComplete:true},
  ]);
  expect([...completeDisplayedOwnUserIds({ref:{},scope:"scope",current:true,projection,localRows:[],hiddenItemKeys:new Set()})]).toEqual([]);
});

import { ownSendPresentation } from "../src/own-send-presentation";
import type { PendingOwnMessage } from "../src/model";
const local=(id:string):PendingOwnMessage=>({scope:'scope',threadId:'t',operationId:id,messageId:id,text:`Original ${id}`,phase:'accepted'});
it('keeps the entire fixed cohort until all exact complete counterparts arrive in canonical order',()=>{
 const a=local('a'),b=local('b'),base={ref:{},current:true,scope:'scope',localRows:[a,b],hiddenItemKeys:new Set<string>(),reservation:{token:{},observation:{installedToken:{},ref:{},scope:'scope',boundary:{kind:'beginning' as const},isCurrent:()=>true}}};
 const node=(id:string,complete=true)=>({windowRevision:1,nodeId:id,itemIdentity:id,kind:'user' as const,text:`Saved ${id}`,textComplete:complete});
 for(const items of [[],[node('b')],[node('a',false),node('b')]]){
  const result=ownSendPresentation({...base,projection:projectSavedItems(items)});
  expect(result.localRows).toEqual([a,b]);expect(result.retire).toEqual([]);expect(result.projection.items).toHaveLength(0);
 }
 const done=ownSendPresentation({...base,projection:projectSavedItems([node('a'),node('b')])});
 expect(done.localRows).toEqual([]);expect(done.retire).toEqual([a,b]);expect(done.projection.items.map(item=>item.source.nodeId)).toEqual(['a','b']);
 const conflict=ownSendPresentation({...base,projection:projectSavedItems([node('b'),node('a')])});
 expect(conflict.conflictIds).toEqual(['a','b']);expect(conflict.retire).toEqual([]);expect(conflict.localRows).toEqual([a,b]);
});
it('requires a mounted sequence member, not just a complete item in the projection array',()=>{
 const projection=projectSavedItems([{windowRevision:1,nodeId:'own',itemIdentity:'item',kind:'user',text:'Saved',textComplete:true}]);
 expect([...completeDisplayedOwnUserIds({ref:{},current:true,scope:'scope',projection:{...projection,sequence:[]},localRows:[],hiddenItemKeys:new Set()})]).toEqual([]);
});
it('retains a complete cohort with explicit conflict when its saved row is at or before the reserved boundary',()=>{
 const own=local('own');
 const node=(id:string)=>({windowRevision:1,nodeId:id,itemIdentity:id,kind:'user' as const,text:id,textComplete:true});
 for(const atAnchor of [false,true]){
  const projection=projectSavedItems(atAnchor?[node('own')]:[node('own'),node('anchor')]);
  const anchor=projection.items.at(-1)!;
  const result=ownSendPresentation({ref:{},current:true,scope:'scope',projection,localRows:[own],hiddenItemKeys:new Set(),nodeOrdinals:new Map([[anchor.source.nodeId!,0]]),path:{tail:true,empty:false,revision:1},reservation:{token:{},observation:{installedToken:{},ref:{},scope:'scope',revision:1,isCurrent:()=>true,boundary:{kind:'item',itemKey:anchor.key,nodeId:anchor.source.nodeId!,ordinal:0,nodeMembers:[anchor.key]}}}});
  expect(result.placement.kind).toBe('qualified');expect(result.localRows).toEqual([own]);expect(result.retire).toEqual([]);expect(result.conflictIds).toEqual(['own']);
  expect(result.projection.items.some(item=>item.source.nodeId==='own')).toBe(false);
 }
});
