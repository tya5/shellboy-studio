import { expect, it } from 'vitest';
import { overlayState, reconcileOverlay, type OverlayToken, type OverlayAction } from '../src/overlay-reconcile';
const token:OverlayToken={owner:'synthetic-owner',session:1,scope:'selected-path',generation:1};
const record={key:'preview-a',attemptId:'attempt-a',text:'retained preview'};
const proof:OverlayAction={type:'proof',token,key:record.key,attemptId:record.attemptId,nodeId:'node-a',itemId:'item-a',revision:'revision-a',loaded:true,visible:true,safeBody:true};
it('associates only exact visible safe loaded replacement without deleting the preview',()=>{
 const s=overlayState(token,[record]);const n=reconcileOverlay(s,proof);
 expect(n.associations).toEqual([{key:record.key,nodeId:'node-a',itemId:'item-a',revision:'revision-a'}]);
 expect(n.records).toEqual([record]);expect(s.associations).toEqual([]);
});
it.each(['loaded','visible','safeBody'] as const)('retains sole preview and no association when %s is absent',field=>{
 const s=overlayState(token,[record]);expect(reconcileOverlay(s,{...proof,[field]:false})).toBe(s);
});
it.each([{...token,owner:'other-owner'},{...token,session:2},{...token,scope:'other-path'},{...token,generation:2}])('rejects proof from different immutable token %j',other=>{
 const s=overlayState(token,[record]);expect(reconcileOverlay(s,{...proof,token:other})).toBe(s);
});
it('owns one lookup until its exact settlement; hints cannot refill starts',()=>{
 let s=overlayState(token,[record]);s=reconcileOverlay(s,{type:'begin',token,operation:1});expect(s.lookup).toBe(1);
 expect(reconcileOverlay(s,{type:'begin',token,operation:2})).toBe(s);
 expect(reconcileOverlay(s,{type:'settled',operation:2})).toBe(s);
 s=reconcileOverlay(s,{type:'settled',operation:1});expect(s.lookup).toBeUndefined();expect(s.starts).toBe(1);
 for(let n=2;n<=8;n++){s=reconcileOverlay(s,{type:'begin',token,operation:n});s=reconcileOverlay(s,{type:'settled',operation:n});}
 expect(s.starts).toBe(8);expect(reconcileOverlay(s,{type:'begin',token,operation:9})).toBe(s);
});
it('scope reconciliation invalidates proof but keeps running lookup until settled',()=>{
 let s=reconcileOverlay(overlayState(token,[record]),{type:'begin',token,operation:1});
 const next={...token,generation:2};s=reconcileOverlay(s,{type:'reconcile',token:next});
 expect(s.token).toEqual(next);expect(s.lookup).toBe(1);expect(s.records).toEqual([record]);
 expect(reconcileOverlay(s,proof)).toBe(s);s=reconcileOverlay(s,{type:'settled',operation:1});expect(s.lookup).toBeUndefined();
});
it('bounds adopted records and UTF-8/per-preview text without inventing overflow admission policy',()=>{
 expect(()=>overlayState(token,Array.from({length:9},(_,n)=>({...record,key:String(n)})))).toThrow();
 expect(()=>overlayState(token,[{...record,text:'a'.repeat(262145)}])).toThrow();
 expect(()=>overlayState(token,Array.from({length:5},(_,n)=>({...record,key:String(n),text:'a'.repeat(262144)})))).toThrow();
});
