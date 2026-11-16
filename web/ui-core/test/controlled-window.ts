import {ConversationWindow,type WindowReadArgs} from '../src/window';
import type {Cancel,Outcome} from '../../data/src';
import type {HistoryWindowInput} from '../../data/src/history-input';
import {captureConversationInput,captureCurrentWork} from '../src/conversation-input';
import {rig as ownerRig,createBoundWindow,boundWindowInput} from './window-owner';

/** Explicit public read barriers and the existing viewport-pause clock; no default replies. */
export async function controlledWindow(){
 const requests:{args:WindowReadArgs;cancel:Cancel;settled:boolean;reply:(value:Outcome<HistoryWindowInput>)=>void}[]=[];
 const timers=new Set<()=>void>();
 const liveCallbacks=new Set<()=>void>();
 const liveSchedule:(callback:()=>void)=>void=callback=>liveCallbacks.add(callback);
 const owner=await ownerRig(0,{schedule:liveSchedule});owner.w.dispose();
 const producer={advance:(attemptId:string)=>{owner.producer.advance(attemptId);while(liveCallbacks.size){const callback=liveCallbacks.values().next().value!;liveCallbacks.delete(callback);callback();},emitLive:(attemptId:string,offset:number,text:string)=>{owner.producer.emitLive(attemptId,offset,text);while(liveCallbacks.size){const callback=liveCallbacks.values().next().value!;liveCallbacks.delete(callback);callback();}}};
 let boundWindow:ConversationWindow;
 const input={state:producer,capture:(snapshot:import('../src/window').WindowAcceptedSnapshot)=>{const capability=boundWindow.acceptedView.currentCapability;return captureConversationInput(snapshot,{scope:owner.handle.threadId,threadId:owner.handle.threadId,records:owner.handle.handoff.value,work:captureCurrentWork(owner.handle.threadId,owner.handle.work.value.value),current:()=>boundWindow.isCurrentThread(owner.handle)&&boundWindow.acceptedView.currentCapability===capability});}};
 boundWindow=createBoundWindow({read:(args,cancel)=>new Promise(resolve=>{
  const request={args,cancel,settled:false,reply:(value:Outcome<HistoryWindowInput>)=>{request.settled=true;resolve(value);}};
  requests.push(request);
 })},owner.handle,input,{setTimer:fn=>{timers.add(fn);return()=>{timers.delete(fn);};}});
 const win=boundWindow;
 return{win,requests,pending:()=>requests.filter(request=>!request.settled&&!request.cancel.cancelled),
  viewportPause:()=>{const admitted=[...timers];timers.clear();admitted.forEach(fn=>fn());},dispose:()=>{win.dispose();owner.handle.close();owner.data.stop();}};
}

/** A real pending-owner input replaces semantics while retaining the selected rows and scroll intent. */
export function publishControlledAttempt(win:ConversationWindow,attemptId:string){
 const before=win.acceptedView.peek();
 const input=boundWindowInput(win);
 if(!input||!input.state)throw new Error('Controlled semantic input was not constructed');
 const state=input.state;
 if(!before.displayPlan?.scope)throw new Error('Controlled semantic replacement requires an accepted scope');
 state.advance(attemptId);
 if(!win.refreshConversationInput(before))throw new Error(`Controlled publication rejected: ${attemptId}`);
 const after=win.acceptedView.peek();
 if(after===before||after.generation<=before.generation)throw new Error(`Controlled publication did not advance: ${attemptId}`);
 return after;
}
