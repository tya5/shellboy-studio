import {expect,it} from 'vitest';
import {projectSavedItems} from '../src/conversation-items';
import {observeOwnSendTail,placeOwnSendRegion} from '../src/own-send-region';
const item=(id:string,nodeId=id)=>({windowRevision:1,nodeId,itemIdentity:id,kind:'user' as const,text:id,textComplete:true});
it('captures only installed qualified tails and preserves an exact multiple-item node boundary',()=>{
 const projection=projectSavedItems([item('a','node'),item('b','node')]);
 const path={tail:true,empty:false,revision:1,lastNodeId:'node',lastOrdinal:3};
 expect(observeOwnSendTail({},undefined,'scope',true,projection,path,()=>true)).toBeUndefined();
 expect(observeOwnSendTail({},{},'scope',true,projection,{...path,tail:false},()=>true)).toBeUndefined();
 const observation=observeOwnSendTail({},{},'scope',true,projection,path,()=>true)!;
 const reservation={token:{},observation};
 const fresh=projectSavedItems([item('a','node'),item('b','node'),item('new')]);
 expect(placeOwnSendRegion(reservation,'scope',true,fresh,path,new Map([['node',3]]))).toEqual({kind:'qualified',insertion:{kind:'conversation',itemKey:projection.items[1]!.key}});
 for(const candidate of [projectSavedItems([item('a','node')]),projectSavedItems([item('a','node'),item('b','node'),item('third','node')]),projectSavedItems([item('new')])])expect(placeOwnSendRegion(reservation,'scope',true,candidate,path,new Map([['node',3]])).kind).toBe('unqualified');
 expect(placeOwnSendRegion(reservation,'scope',true,fresh,{...path,revision:2},new Map([['node',3]]))).toEqual({kind:'unqualified',reason:'revision-changed'});
 expect(placeOwnSendRegion(reservation,'scope',true,fresh,path,new Map([['node',4]]))).toEqual({kind:'unqualified',reason:'boundary-conflict'});
 expect(placeOwnSendRegion(undefined,'scope',true,fresh,path,new Map()).kind).toBe('unqualified');
});
it('does not split an extended Work group or duplicate its key around the local region',()=>{
 const fact=(id:string)=>({windowRevision:1,nodeId:id,itemIdentity:id,kind:'reasoning_unavailable' as const});
 const projection=projectSavedItems([fact('a')]);
 const path={tail:true,empty:false,revision:1,lastNodeId:'a',lastOrdinal:0};
 const observation=observeOwnSendTail({},{},'scope',true,projection,path,()=>true)!;
 const reservation={token:{},observation};
 expect(placeOwnSendRegion(reservation,'scope',true,projection,path,new Map([['a',0]])).kind).toBe('qualified');
 const extended=projectSavedItems([fact('a'),fact('b')]);
 expect(placeOwnSendRegion(reservation,'scope',true,extended,path,new Map([['a',0]]) )).toEqual({kind:'unqualified',reason:'boundary-conflict'});
});
