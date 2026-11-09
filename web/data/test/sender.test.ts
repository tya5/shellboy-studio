import { describe, expect, it } from 'vitest';
import { senderFact } from '../src/sender';
describe('existing owner sender identity guard',()=>{
  it('preserves opaque ID and self-asserted label independently',()=>{
    expect(senderFact({kind:'model',thread_id:' opaque id ',label:'<claimed>'})).toEqual({kind:'model',threadId:' opaque id ',label:'<claimed>'});
    expect(senderFact({kind:'model',thread_id:'sender-a'})).toEqual({kind:'model',threadId:'sender-a'});
  });
  it.each([null,[],{},undefined,'human'])('never infers human from malformed %j',value=>expect(senderFact(value).kind).toBe('unknown'));
  it.each([undefined,null,'', '  ',17,{}])('keeps invalid model IDs unknown rather than human: %j',thread_id=>expect(senderFact({kind:'model',thread_id,label:'claimed'})).toEqual({kind:'unknown_model',label:'claimed'}));
  it('never attaches model identity to human or CLI records',()=>{
    expect(senderFact({kind:'human',thread_id:'not-model'})).toEqual({kind:'human'});
    expect(senderFact({kind:'external_cli',thread_id:'not-model',label:'cli'})).toEqual({kind:'external_cli',label:'cli'});
  });
});
