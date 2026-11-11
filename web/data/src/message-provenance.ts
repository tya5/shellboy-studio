import type {HistoryItem, MessageProvenance, NotificationDescriptor} from './protocol';
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
/** Invalid optional notification metadata is quarantined, not a body rejection. */
export function admitNotificationDescriptor(value:unknown):NotificationDescriptor|undefined{
 if(!object(value))return;
 const encoded=JSON.stringify(value);
 if(encoded===undefined||bytes.encode(encoded).length>2048)return;
 let allowed:readonly string[];
 switch(value.kind){
  case 'turn_started': case 'recovery_resumed': allowed=['kind'];break;
  case 'instructions_observed':
   allowed=['kind','observation'];
   if(!['first_seen','updated','removed'].includes(value.observation as string))return;
   break;
  case 'thread_settings_changed':
   allowed=['kind','changed_fields'];
   if(!Array.isArray(value.changed_fields)||value.changed_fields.length===0||value.changed_fields.length>4)return;
   if(!value.changed_fields.every(field=>typeof field==='string'&&['cwd','connection','model','effort'].includes(field))||new Set(value.changed_fields).size!==value.changed_fields.length)return;
   break;
  case 'shell_ended':
   allowed=['kind','execution_id','state','exit_code'];
   if(typeof value.execution_id!=='string'||!value.execution_id.trim()||bytes.encode(value.execution_id).length>256)return;
   if(!['exited','failed','stopped'].includes(value.state as string))return;
   if(Object.hasOwn(value,'exit_code')&&(typeof value.exit_code!=='number'||!Number.isInteger(value.exit_code)||value.exit_code< -2147483648||value.exit_code>2147483647))return;
   break;
  default:return;
 }
 if(Object.keys(value).some(key=>!allowed.includes(key))||Object.values(value).some(field=>field===null))return;
 // Preserve exact admitted fields; no result/name/command/body inference.
 return value as unknown as NotificationDescriptor;
}
export function sanitizeMessageRelation<T extends {node_id?:string;provenance?:unknown}>(node:T):T{
 const provenance=node.provenance;
 if(!object(provenance))return node;
 const hasMessage=Object.hasOwn(provenance,'message');
 const hasNotification=Object.hasOwn(provenance,'notification');
 if(!hasMessage&&!hasNotification)return node;
 const {message,notification,...independent}=provenance;
 const admitted=hasMessage?admitMessageProvenance(message,node.node_id):undefined;
 const admittedNotification=hasNotification?admitNotificationDescriptor(notification):undefined;
 return {...node,provenance:{...independent,...(admitted?{message:admitted}:{}),...(admittedNotification?{notification:admittedNotification}:{})}};
}
