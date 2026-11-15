import {captureDecode,createInputCapture,InputCaptureError} from './immutable-input';
import type {HistoryItem,HistoryWindowResult} from './protocol';
import type {Outcome} from './errors';

function freezeHistory(value:HistoryWindowResult):HistoryWindowResult{
 for(const row of value.items){
  if(row.selection&&typeof row.selection==='object')Object.freeze(row.selection);
  if(Array.isArray(row.items)){for(const item of row.items)if(item&&typeof item==='object')Object.freeze(item);Object.freeze(row.items);}
  if(row.provenance&&typeof row.provenance==='object')Object.freeze(row.provenance);
  Object.freeze(row);
 }
 Object.freeze(value.items);Object.freeze(value);return value;
}
export class HistoryWindowInput implements HistoryWindowResult {
 readonly thread_id:string;readonly revision:number;readonly total:number;readonly items:HistoryItem[];
 readonly #visits:number;
 private constructor(value:HistoryWindowResult,visits:number){
  value=freezeHistory(value);
  this.thread_id=value.thread_id;this.revision=value.revision;this.total=value.total;this.items=value.items;this.#visits=visits;Object.freeze(this);
 }
 static own(value:HistoryWindowResult):HistoryWindowInput{
  if(value instanceof HistoryWindowInput)return value;
  const capture=createInputCapture(),owned=capture(value);
  return new HistoryWindowInput(owned,capture.visits??0);
 }
 static decode(raw:unknown,decoder:(value:unknown)=>{ok:true;value:HistoryWindowResult}|{ok:false;reason:string}):Outcome<HistoryWindowResult>{
  return captureDecode(raw,(owned,visits)=>{
   const decoded=decoder(owned); if(!decoded.ok) throw new InputCaptureError('invalid-input');
   return new HistoryWindowInput(decoded.value,visits);
  });
 }
 static join(pages:readonly HistoryWindowInput[]):HistoryWindowInput{
  const first=pages[0];if(!first)throw new InputCaptureError('invalid-input');
  const visits=pages.reduce((total,page)=>total+page.#visits,0);
  if(visits>65536)throw new InputCaptureError('input-bound');
  const rows=pages.flatMap(page=>page.items);Object.freeze(rows);
  return new HistoryWindowInput({...first,items:rows},visits);
 }
}

export function ownHistoryOutcome(out:Outcome<HistoryWindowResult>):Outcome<HistoryWindowResult>{
 if(!out.ok)return out;
 if(out.value instanceof HistoryWindowInput)return out;
 return HistoryWindowInput.decode(out.value,value=>({ok:true,value:value as HistoryWindowResult}));
}
