// @vitest-environment happy-dom
import {expect,it} from 'vitest';
import {flush} from '../../../data/test/harness';
import {rig} from '../../../ui-core/test/window-owner';
it('actual Window readTail partial response must not convert pending tail proof into user detach',async()=>{
 const r=await rig(100);try{
  await r.settle();expect(r.w.following.value).toBe(true);
  r.owner.append(1000);r.w.changed();await flush();
  const partial=r.calls().filter(c=>!r.owner.answered.has(c.id))[0]!;expect(partial).toBeDefined();
  r.owner.answered.add(partial.id);const answer=r.owner.answer(partial);expect(answer.ok).toBe(true);if(answer.ok)r.t.ok(partial.id,answer.result);await flush();
  // Latest tail reply is still held; the user has supplied no detach action.
  expect(r.calls().some(c=>!r.owner.answered.has(c.id))).toBe(true);
  r.w.view(0,600,true);
  expect(r.w.following.value).toBe(true);
 }finally{r.w.dispose();r.data.stop();}
});
