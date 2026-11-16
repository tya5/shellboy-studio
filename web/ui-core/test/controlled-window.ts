import {ConversationWindow,type WindowReadArgs} from '../src/window';
import type {Cancel,Outcome} from '../../data/src';
import type {HistoryWindowInput} from '../../data/src/history-input';
import {captureConversationInput,captureCurrentWork} from '../src/conversation-input';

/** Explicit public read barriers and the existing viewport-pause clock; no default replies. */
export function controlledWindow(){
 const requests:{args:WindowReadArgs;cancel:Cancel;settled:boolean;reply:(value:Outcome<HistoryWindowInput>)=>void}[]=[];
 const timers=new Set<()=>void>();
 const win=new ConversationWindow({read:(args,cancel)=>new Promise(resolve=>{
  const request={args,cancel,settled:false,reply:(value:Outcome<HistoryWindowInput>)=>{request.settled=true;resolve(value);}};
  requests.push(request);
 })},{setTimer:fn=>{timers.add(fn);return()=>{timers.delete(fn);};}});
 return{win,requests,pending:()=>requests.filter(request=>!request.settled&&!request.cancel.cancelled),
  viewportPause:()=>{const admitted=[...timers];timers.clear();admitted.forEach(fn=>fn());}};
}

/** A real pending-owner input replaces semantics while retaining the selected rows and scroll intent. */
const controlledSemantic=Symbol("controlledSemantic");
type ControlledSemanticState={version:number;capability:unknown};
type ControlledSemanticWindow=ConversationWindow&{[controlledSemantic]?:ControlledSemanticState};
export function publishControlledAttempt(win:ConversationWindow,attemptId:string){
 const controlled=win as ControlledSemanticWindow,before=win.acceptedView.peek();
 if(!before.displayPlan?.scope)throw new Error('Controlled semantic replacement requires an accepted scope');
 let state=controlled[controlledSemantic];
 if(!state){
  state={version:0,capability:win.acceptedView.currentCapability};controlled[controlledSemantic]=state;
  if(!win.bindConversationInput(snapshot=>{
   const capturedVersion=state!.version;
   return captureConversationInput(snapshot,{scope:`controlled:${attemptId}:${capturedVersion}`,threadId:'controlled',records:[],work:captureCurrentWork(`controlled:${attemptId}:${capturedVersion}`,undefined),current:()=>win.acceptedView.currentCapability===state!.capability&&state!.version===capturedVersion});
  }))throw new Error('Controlled semantic input was already bound');
 }
 state.version++;
 if(!win.refreshConversationInput(before))throw new Error(`Controlled publication rejected: ${attemptId}`);
 const after=win.acceptedView.peek();
 if(after===before||after.generation<=before.generation)throw new Error(`Controlled publication did not advance: ${attemptId}`);
 return after;
}
