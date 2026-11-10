import {expect,it} from 'vitest';
import {FakeTransport} from './harness';
import {Link} from '../src/link';
import {Operations} from '../src/operations';
it.each([{message_id:'canonical-node',thread_id:'thread'}, {}, {message_id:'',thread_id:'thread'},{message_id:'canonical-node',thread_id:''}])('strict message acceptance: %j',async receipt=>{
 const t=new FakeTransport(),link=new Link(t);link.start();t.open();
 const pending=new Operations(link,()=> 'original-operation').messageSend({thread_id:'thread',text:'Synthetic submitted text'});
 t.ok(t.calls()[0]!.id,receipt);const out=await pending;link.stop();
 expect(out.ok).toBe('message_id' in receipt && !!receipt.message_id && !!receipt.thread_id);
 if(out.ok)expect(out.value).toEqual(receipt);
});
