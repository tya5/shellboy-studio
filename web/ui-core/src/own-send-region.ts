import type { SavedItemProjection } from "./conversation-items";

export interface OwnSendPath {
  readonly tail: boolean;
  readonly revision?: string | number;
  readonly lastNodeId?: string;
  readonly lastOrdinal?: number;
  readonly empty: boolean;
}
export type OwnSendBoundary = Readonly<{kind:"beginning"}> | Readonly<{
  kind:"item"; itemKey:string; nodeId:string; ordinal:number;
  nodeMembers:readonly string[]; workMembers?:readonly string[];
}>;
export interface OwnSendTailObservation<Ref> {
  readonly installedToken:object; readonly ref:Ref; readonly scope:string;
  readonly revision?:string|number; readonly boundary:OwnSendBoundary;
  readonly isCurrent:()=>boolean;
}
export interface OwnSendReservation<Ref> { readonly token:object; readonly observation:OwnSendTailObservation<Ref> }
export type OwnSendInsertion = Readonly<{kind:"beginning"}> | Readonly<{kind:"conversation";itemKey:string}> | Readonly<{kind:"work";groupKey:string}>;
export type OwnSendPlacement = Readonly<{kind:"qualified";insertion:OwnSendInsertion}> | Readonly<{kind:"unqualified";reason:"tail-unproved"|"scope-changed"|"revision-changed"|"boundary-missing"|"boundary-conflict"}>;

/** Called with an installed final CASE projection, never with a second history projection. */
export function observeOwnSendTail<Ref>(token:object,ref:Ref|undefined,scope:string,current:boolean,projection:SavedItemProjection,path:OwnSendPath|undefined,isCurrent:()=>boolean):OwnSendTailObservation<Ref>|undefined {
  if(!ref||!current||!path?.tail)return;
  if(path.empty && projection.items.length===0)return Object.freeze({installedToken:token,ref,scope,revision:path.revision,boundary:Object.freeze({kind:"beginning" as const}),isCurrent});
  const last=projection.sequence?.at(-1);
  const group=last?.kind==="work"?projection.workGroups?.find(group=>group.key===last.groupKey):undefined;
  const key=last?.kind==="conversation"?last.itemKey:group?.memberKeys.at(-1);
  const item=projection.items.find(item=>item.key===key);
  if(!key||!item?.source.nodeId||item.source.nodeId!==path.lastNodeId||!Number.isSafeInteger(path.lastOrdinal))return;
  const nodeMembers=projection.items.filter(member=>member.source.nodeId===item.source.nodeId).map(member=>member.key);
  if(nodeMembers.length>64 || group && group.memberKeys.length>64)return;
  return Object.freeze({installedToken:token,ref,scope,revision:path.revision,isCurrent,boundary:Object.freeze({kind:"item" as const,itemKey:key,nodeId:item.source.nodeId,ordinal:path.lastOrdinal!,nodeMembers:Object.freeze(nodeMembers),workMembers:group?Object.freeze([...group.memberKeys]):undefined})});
}
export function placeOwnSendRegion<Ref>(reservation:OwnSendReservation<Ref>|undefined,scope:string,current:boolean,projection:SavedItemProjection,path:OwnSendPath|undefined,nodeOrdinals:ReadonlyMap<string,number>):OwnSendPlacement {
  const bad=(reason:Extract<OwnSendPlacement,{kind:"unqualified"}>["reason"]):OwnSendPlacement=>Object.freeze({kind:"unqualified",reason});
  if(!reservation||!current)return bad("tail-unproved");
  const observed=reservation.observation;
  if(observed.scope!==scope)return bad("scope-changed");
  if(observed.revision!==path?.revision)return bad("revision-changed");
  const anchor=observed.boundary;
  if(anchor.kind==="beginning")return Object.freeze({kind:"qualified",insertion:Object.freeze({kind:"beginning"})});
  const item=projection.items.find(item=>item.key===anchor.itemKey&&item.source.nodeId===anchor.nodeId);
  if(!item)return bad("boundary-missing");
  if(nodeOrdinals.get(anchor.nodeId)!==anchor.ordinal)return bad("boundary-conflict");
  const members=projection.items.filter(item=>item.source.nodeId===anchor.nodeId).map(item=>item.key);
  if(JSON.stringify(members)!==JSON.stringify(anchor.nodeMembers))return bad("boundary-conflict");
  const entry=projection.sequence?.find(entry=>entry.kind==="conversation"?entry.itemKey===anchor.itemKey:projection.workGroups?.find(group=>group.key===entry.groupKey)?.memberKeys.includes(anchor.itemKey));
  if(!entry)return bad("boundary-missing");
  if(entry.kind==="work"){
    const group=projection.workGroups?.find(group=>group.key===entry.groupKey);
    if(!group||group.memberKeys.at(-1)!==anchor.itemKey||JSON.stringify(group.memberKeys)!==JSON.stringify(anchor.workMembers))return bad("boundary-conflict");
  }else if(anchor.workMembers)return bad("boundary-conflict");
  return Object.freeze({kind:"qualified",insertion:entry});
}
