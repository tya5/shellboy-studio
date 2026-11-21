import {Handoff} from '../src/handoff';
import {admitAttemptId} from '../src/message-provenance';
import type {AttemptId, HistoryItem, ResponseNodeRef, WorkItem} from '../src/protocol';

/** Public status DTO construction; references are supplied from fixture-owned selected inputs. */
export function attemptWork(input:{threadId:string;attemptId:string;turnId:string;state:string;
 refs:readonly ResponseNodeRef[];truncated?:boolean}):WorkItem{
 return{kind:'attempt',id:input.attemptId,attempt_id:input.attemptId,turn_id:input.turnId,thread_id:input.threadId,
  state:input.state,response_nodes:input.refs.map(ref=>({...ref})),response_nodes_truncated:input.truncated??false};
}


export function canonicalAttemptId(n:number):AttemptId{const value=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;if(!admitAttemptId(value))throw new Error('invalid canonical fixture ID');return value;}
export const CANONICAL_ATTEMPT_ID = canonicalAttemptId(1);
export function withCanonicalAttemptProvenance(rows:readonly HistoryItem[], attemptId:AttemptId=CANONICAL_ATTEMPT_ID):HistoryItem[]{
 return rows.map(row=>row.kind==='assistant_response' ? {...row,provenance:{...row.provenance,attempt_id:attemptId}} : row);
}
