import {expect,it} from 'vitest';
import {localSendAdmission} from '../src/local-send-admission';
it('preserves pending precedence and slots-first capacity without mutating escrow',()=>{
 const rows=Array.from({length:8},()=>Object.freeze({text:'x'}));
 expect(localSendAdmission(true,rows,'x'.repeat(4194305))).toBe('pendingphase');
 expect(localSendAdmission(false,rows,'x'.repeat(4194305))).toBe('slotsfull');expect(rows).toHaveLength(8);
});
it('recomputes edited UTF8 bytes at the exact retained limit without latching old errors',()=>{
 const rows=[{text:'x'.repeat(4194301)}];
 expect(localSendAdmission(false,rows,'あ')).toBe('ready');
 expect(localSendAdmission(false,rows,'あx')).toBe('bytesfull');
 expect(localSendAdmission(false,rows,'xx')).toBe('ready');
});
