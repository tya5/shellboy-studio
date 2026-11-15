import {createInputCapture,InputCaptureError} from './immutable-input';
import type {HistoryItem,HistoryWindowResult} from './protocol';
import type {Outcome} from './errors';
export class HistoryWindowInput implements HistoryWindowResult {
 readonly thread_id:string;readonly revision:number;readonly total:number;readonly items:HistoryItem[];
 readonly #visits:number;
 private constructor(value:HistoryWindowResult,visits:number){
  this.thread_id=value.thread_id;this.revision=value.revision;this.total=value.total;this.items=value.items;this.#visits=visits;Object.freeze(this);
 }
 static own(value:HistoryWindowResult):HistoryWindowInput{
  if(value instanceof HistoryWindowInput)return value;
  const capture=createInputCapture(),owned=capture(value);
  return new HistoryWindowInput(owned,capture.visits??0);
 }
 static fromCaptured(value:HistoryWindowResult,visits:number):HistoryWindowInput{
  if(value instanceof HistoryWindowInput)return value;
  return new HistoryWindowInput(value,visits);
 }
 static join(pages:readonly HistoryWindowInput[]):HistoryWindowInput{
  const first=pages[0];if(!first)throw new InputCaptureError('invalid-input');
  const visits=pages.reduce((total,page)=>total+page.#visits,0);
  if(visits>65536)throw new InputCaptureError('input-bound');
  const rows=pages.flatMap(page=>page.items);Object.freeze(rows);
  return new HistoryWindowInput({...first,items:rows},visits);
 }
}
export function ownCapturedHistoryOutcome(out:Outcome<HistoryWindowResult>,visits:number):Outcome<HistoryWindowResult>{
 if(!out.ok)return out;
 return{ok:true,value:HistoryWindowInput.fromCaptured(out.value,visits)};
}
export function ownHistoryOutcome(out:Outcome<HistoryWindowResult>):Outcome<HistoryWindowResult>{
 if(!out.ok)return out;
 try{return{ok:true,value:HistoryWindowInput.own(out.value)};}
 catch(error){return{ok:false,error:{kind:'invalid_response',message:error instanceof InputCaptureError?error.reason:'invalid-input'}};}
}
