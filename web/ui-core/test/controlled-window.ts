import {ConversationWindow,type WindowReadArgs} from '../src/window';
import type {Cancel,Outcome} from '../../data/src';
import type {HistoryWindowResult} from '../../data/src/protocol';

/** Explicit public read barriers and the existing viewport-pause clock; no default replies. */
export function controlledWindow(){
 const requests:{args:WindowReadArgs;cancel:Cancel;settled:boolean;reply:(value:Outcome<HistoryWindowResult>)=>void}[]=[];
 const timers=new Set<()=>void>();
 const win=new ConversationWindow({read:(args,cancel)=>new Promise(resolve=>{
  const request={args,cancel,settled:false,reply:(value:Outcome<HistoryWindowResult>)=>{request.settled=true;resolve(value);}};
  requests.push(request);
 })},{setTimer:fn=>{timers.add(fn);return()=>{timers.delete(fn);};}});
 return{win,requests,pending:()=>requests.filter(request=>!request.settled&&!request.cancel.cancelled),
  viewportPause:()=>{const admitted=[...timers];timers.clear();admitted.forEach(fn=>fn());}};
}

/** A real pending-owner input replaces semantics while retaining the selected rows and scroll intent. */
export function publishControlledAttempt(win:ConversationWindow,attemptId:string){
 const scope=win.acceptedView.peek().displayPlan?.scope;
 if(!scope)throw new Error('Controlled semantic replacement requires an accepted scope');
 win.setAttemptPresentations([{scope,attemptId,turnId:`${attemptId}-turn`,nodeIds:[`unselected-${attemptId}`],state:'pending'}]);
 return win.acceptedView.peek();
}
