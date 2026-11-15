import {captureDecode,createInputCapture,InputCaptureError} from './immutable-input';
import type {HistoryItem,HistoryWindowResult} from './protocol';
import {decodeHistoryWindow} from './history-decoder';
import type {Outcome} from './errors';
export const MAX_HISTORY_ROWS = 1600;

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
 declare private readonly __ownedHistoryWindow: void;
 readonly thread_id:string;readonly revision:number;readonly total:number;readonly items:HistoryItem[];

 private constructor(value:HistoryWindowResult){
  value=freezeHistory(value);
  this.thread_id=value.thread_id;this.revision=value.revision;this.total=value.total;this.items=value.items;Object.freeze(this);
 }
 static decode(raw:unknown):Outcome<HistoryWindowInput>{
  return captureDecode(raw,(owned)=>{
   const decoded=decodeHistoryWindow(owned); if(!decoded.ok) throw new InputCaptureError('invalid-input');
   return new HistoryWindowInput(decoded.value);
  });
 }
 static join(pages:readonly HistoryWindowInput[]):HistoryWindowInput{
  const first=pages[0];if(!first)throw new InputCaptureError('invalid-input');
  const rows=pages.flatMap(page=>page.items);
  if(rows.length>MAX_HISTORY_ROWS)throw new InputCaptureError('input-bound');
  Object.freeze(rows);
  return new HistoryWindowInput({...first,items:rows});
 }
}

export function ownHistoryOutcome(out:Outcome<HistoryWindowResult>):Outcome<HistoryWindowResult>{
 if(!out.ok)return out;
 if(out.value instanceof HistoryWindowInput)return out;
 return HistoryWindowInput.decode(out.value);
}
