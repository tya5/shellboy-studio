import {Handoff,type PresentationContainerId} from '../src/handoff';
import {admitAttemptId} from '../src/message-provenance';
import type {SelectedResponseRef} from '../src/public-response-refs';
import type {AttemptId, HistoryItem, ResponseNodeRef, WorkItem} from '../src/protocol';

/** Public status DTO construction; references are supplied from fixture-owned selected inputs. */
export function attemptWork(input:{threadId:string;attemptId:string;turnId:string;state:string;
 refs:readonly ResponseNodeRef[];truncated?:boolean}):WorkItem{
 return{kind:'attempt',id:input.attemptId,attempt_id:input.attemptId,turn_id:input.turnId,thread_id:input.threadId,
  state:input.state,response_nodes:input.refs.map(ref=>({...ref})),response_nodes_truncated:input.truncated??false};
}

/** Internal ready-proof fixture inputs retain selected tuples and repeated reference order. */
export function selectedReadyRefs(nodeIds:readonly string[],rows:readonly HistoryItem[]):readonly SelectedResponseRef[]{
 return nodeIds.map(nodeId=>{
  const matches=rows.filter(row=>row.node_id===nodeId),node=matches[0];
  const ordinal=node?.selection?.ordinal,kind=node?.kind;
  if(matches.length!==1||typeof ordinal!=='number'||!Number.isSafeInteger(ordinal)||ordinal<0||typeof kind!=='string'||!kind)
   throw new Error('selected ready fixture requires an exact selected tuple');
  return{nodeId,ordinal,kind};
 });
}

export function syntheticPresentation(attemptId:string):PresentationContainerId{
 const ledger=new Handoff(fn=>fn());ledger.apply({attempt_id:attemptId,gap:false,deltas:[]});
 const container=ledger.records.peek()[0]!.presentationContainer;ledger.discard('ended');return container;
}


export function canonicalAttemptId(n:number):AttemptId{const value=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;if(!admitAttemptId(value))throw new Error('invalid canonical fixture ID');return value;}
export const CANONICAL_ATTEMPT_ID = canonicalAttemptId(1);
export function withCanonicalAttemptProvenance(rows:readonly HistoryItem[], attemptId:AttemptId=CANONICAL_ATTEMPT_ID):HistoryItem[]{
 return rows.map(row=>row.kind==='assistant_response' ? {...row,provenance:{...row.provenance,attempt_id:attemptId}} : row);
}


export interface DeclaredAttemptIdentity { readonly attemptId:string; readonly recordKey:string; readonly receiptRecordId:string }
export function declaredAttemptIdentity(attemptId:string):DeclaredAttemptIdentity{return{attemptId,recordKey:`handoff:${attemptId}`,receiptRecordId:attemptId};}
