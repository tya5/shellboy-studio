import type {ResponseNodeRef, WorkItem} from '../src/protocol';

/** Public status DTO construction; references are supplied from fixture-owned selected inputs. */
export function attemptWork(input:{threadId:string;attemptId:string;turnId:string;state:string;
 refs:readonly ResponseNodeRef[];truncated?:boolean}):WorkItem{
 return{kind:'attempt',id:input.attemptId,attempt_id:input.attemptId,turn_id:input.turnId,thread_id:input.threadId,
  state:input.state,response_nodes:input.refs.map(ref=>({...ref})),response_nodes_truncated:input.truncated??false};
}
