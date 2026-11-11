import type {HistoryItem, MessageProvenance} from './protocol';
const bytes=new TextEncoder();
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
/** Optional metadata rejection cannot reject independent sender or body facts. */
export function admitMessageProvenance(value:unknown,nodeId:unknown):MessageProvenance|undefined{
 if(!object(value)||bytes.encode(JSON.stringify(value)).length>4096)return;
 if(Object.keys(value).some(key=>!['expect_reply','reply_to','reply_state','reply_node_id'].includes(key)))return;
 const id=(v:unknown)=>typeof v==='string'&&v.length>0&&bytes.encode(v).length<=256&&v!==nodeId;
 const absent=(key:string)=>!Object.hasOwn(value,key);
 if(value.expect_reply===false){
  if(!absent('reply_state')||!absent('reply_node_id'))return;
  if(absent('reply_to'))return {expect_reply:false};
  if(id(value.reply_to))return {expect_reply:false,reply_to:value.reply_to as string};
 }else if(value.expect_reply===true&&absent('reply_to')){
  if(value.reply_state==='replied'&&id(value.reply_node_id))return {expect_reply:true,reply_state:'replied',reply_node_id:value.reply_node_id as string};
  if(['pending','ignored','cancelled'].includes(value.reply_state as string)&&absent('reply_node_id'))return {expect_reply:true,reply_state:value.reply_state as 'pending'|'ignored'|'cancelled'};
 }
}
export function sanitizeMessageRelation(node:HistoryItem):HistoryItem{
 const provenance=node.provenance;
 if(!object(provenance)||!Object.hasOwn(provenance,'message'))return node;
 const {message,...independent}=provenance;
 const admitted=admitMessageProvenance(message,node.node_id);
 return {...node,provenance:{...independent,...(admitted?{message:admitted}:{})}};
}
