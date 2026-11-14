import type {HistoryItem,ResponseNodeRef,WorkItem} from './protocol';

declare const publicRefsBrand:unique symbol;
export interface SelectedResponseRef {readonly nodeId:string;readonly ordinal:number;readonly kind:string}
export type QualifiedPublicResponseRefs=readonly SelectedResponseRef[] & {readonly[publicRefsBrand]:true};

/** Public status references identify one ordered selected node each; internal ready refs are separate. */
function qualify(refs:readonly ResponseNodeRef[]|undefined):QualifiedPublicResponseRefs|undefined{
 if(!Array.isArray(refs)||!refs.length||refs.length>64)return;
 const identities=new Set<string>();let previous=-1;
 for(const ref of refs){
  if(!ref||typeof ref.node_id!=='string'||!ref.node_id||identities.has(ref.node_id)
   ||!Number.isSafeInteger(ref.ordinal)||ref.ordinal<0||ref.ordinal<=previous||typeof ref.kind!=='string'||!ref.kind)return;
  identities.add(ref.node_id);previous=ref.ordinal;
 }
 return Object.freeze(refs.map(ref=>Object.freeze({nodeId:ref.node_id,ordinal:ref.ordinal,kind:ref.kind}))) as QualifiedPublicResponseRefs;
}
/** One bounded qualification pass feeds both association and readable-proof admission. */
export function capturePublicResponseScope(items:readonly WorkItem[],threadId:string){
 const references=new Map<WorkItem,QualifiedPublicResponseRefs>();let complete=true;
 for(const item of items){
  if(item.kind!=='attempt')continue;
  const refs=qualify(item.response_nodes);
  if(refs)references.set(item,refs);
  if(!['completed','failed','incomplete','cancelled'].includes(item.state)||item.thread_id!==threadId
   ||typeof item.attempt_id!=='string'||!item.attempt_id.trim()||typeof item.turn_id!=='string'||!item.turn_id.trim()
   ||item.response_nodes_truncated!==false||!Array.isArray(item.response_nodes)
   ||item.response_nodes.length>0&&!refs)complete=false;
 }
 return{complete,references};
}
/** Evidence may contain independent rows, but every reported ref must match its exact selected node. */
export function responseRefsMatchSelected(refs:readonly SelectedResponseRef[],nodes:readonly HistoryItem[]):boolean{
 const selected=new Map(nodes.map(node=>[node.node_id,node]));
 const ordinals=new Set(nodes.map(node=>node.selection?.ordinal));
 return selected.size===nodes.length&&ordinals.size===nodes.length
  &&nodes.every(node=>typeof node.node_id==='string'&&!!node.node_id&&typeof node.selection?.ordinal==='number'&&Number.isSafeInteger(node.selection.ordinal)&&node.selection.ordinal>=0)
  &&refs.every(ref=>{
  const node=selected.get(ref.nodeId);return !!node&&node.selection?.ordinal===ref.ordinal&&node.kind===ref.kind;
 });
}
