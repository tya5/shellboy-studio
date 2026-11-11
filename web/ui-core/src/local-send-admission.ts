export type LocalSendAdmission = 'ready' | 'pendingphase' | 'slotsfull' | 'bytesfull';
const utf8 = new TextEncoder();
/** Local escrow limits only; ready does not grant owner/route mutation authority. */
export function localSendAdmission(pending:boolean, accepted:readonly {text:string}[], text:string):LocalSendAdmission {
 if(pending)return 'pendingphase';
 if(accepted.length>=8)return 'slotsfull';
 const bytes=accepted.reduce((sum,row)=>sum+utf8.encode(row.text).byteLength,utf8.encode(text).byteLength);
 return bytes>4*1024*1024?'bytesfull':'ready';
}
