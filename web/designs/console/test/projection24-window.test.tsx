// @vitest-environment happy-dom
import {expect,it} from 'vitest';
import {flush} from '../../../data/test/harness';
import {rig} from '../../../ui-core/test/window-owner';
it('actual Window readTail partial response must not convert pending tail proof into user detach',async()=>{
 const r=await rig(100);r.owner.decorate=(_i,item)=>({...item,kind:"user"});try{
  await r.settle();expect(r.w.following.value).toBe(true);
  r.owner.append(1000);r.w.changed();await flush();
  const partial=r.calls().filter(c=>!r.owner.answered.has(c.id))[0]!;expect(partial).toBeDefined();
  r.owner.answered.add(partial.id);const answer=r.owner.answer(partial);expect(answer.ok).toBe(true);if(answer.ok)r.t.ok(partial.id,answer.result);for(let i=0;i<24;i++)await flush();
  console.log(JSON.stringify({calls:r.calls().map(c=>({id:c.id,args:c.args,answered:r.owner.answered.has(c.id)})),total:r.w.total,range:r.w.renderRange(),following:r.w.following.value}));
  // Latest tail reply is still held; the user has supplied no detach action.
  expect(r.calls().some(c=>!r.owner.answered.has(c.id))).toBe(true);
  r.w.view(0,600,true);
  expect(r.w.following.value).toBe(true);
 }finally{r.w.dispose();r.data.stop();}
});

it('actual Window readTail observers see one rows/range/total/revision generation and reentry skips old notification',async()=>{
 const r=await rig(4);r.owner.decorate=(_i,item)=>({...item,kind:'user'});
 try{
  const tuples:number[]=[];let reenter=false;
  r.w.acceptedView.subscribe(ref=>{
   if(ref.rows.length&&!reenter){reenter=true;r.w.layoutChanged();}
  });
  r.w.acceptedView.subscribe(ref=>{
   expect(ref).toBe(r.w.acceptedView.peek());expect(r.w.acceptedView.isCurrent(ref)).toBe(true);
   expect(ref.rows).toEqual(r.w.rangeItems());expect(ref.range).toEqual(r.w.renderRange());expect(ref.total).toBe(r.w.total);
   expect(ref.rows.every(row=>row.selection!.ordinal!<ref.total)).toBe(true);
   if(ref.rows.length){expect(ref.revision).toBe(r.owner.revision);expect(ref.range).toEqual({first:0,last:ref.total-1});}
   tuples.push(ref.generation);
  });
  await r.settle();expect(reenter).toBe(true);expect(tuples.length).toBeGreaterThan(0);
  const old=r.w.acceptedView.peek();r.owner.append(1);r.w.changed();await r.settle();
  expect(r.w.acceptedView.peek().revision).toBe(2);expect(r.w.acceptedView.peek().total).toBe(5);expect(r.w.acceptedView.peek()).not.toBe(old);
 }finally{r.w.dispose();r.data.stop();}
});

it.each(['replace','revoke','dispose'] as const)('actual Window G port %s during measurement consumes/writes/captures zero',async(action)=>{
 const {CurrentScrollSync}=await import('../screens/scrollTransaction');const r=await rig(4);r.owner.decorate=(_i,item)=>({...item,kind:'user'});
 try{
  await r.settle();const ref=r.w.acceptedView.peek();const pending=r.w.peekScroll(ref);expect(pending).toBeDefined();
  let consumes=0,writes=0,captures=0;
  const result=new CurrentScrollSync().run({acceptedView:r.w.acceptedView,peekScroll:value=>r.w.peekScroll(value),consumeScroll:(value,id)=>{consumes++;return r.w.consumeScroll(value,id)}},{measure(){if(action==='replace')r.w.layoutChanged();else if(action==='revoke')r.w.acceptedView.revoke();else r.w.dispose();},plan(){return{consume(){consumes++},write(){writes++},capture(){captures++}}}});
  expect(result).toBe('obsolete');expect(consumes).toBe(0);expect(writes).toBe(0);expect(captures).toBe(0);
  expect(r.w.consumeScroll(ref,pending!.id)).toBe(false);
  if(action==='revoke'){expect(r.w.acceptedView.peek()).toBe(ref);expect(r.w.acceptedView.isCurrent(ref)).toBe(false);}
  if(action==='replace'){
   const current=r.w.acceptedView.peek();expect(r.w.peekScroll(current)).toBe(pending);expect(r.w.consumeScroll(current,{})).toBe(false);
   expect(r.w.peekScroll(current)).toBe(pending);expect(r.w.consumeScroll(current,pending!.id)).toBe(true);expect(r.w.consumeScroll(current,pending!.id)).toBe(false);
  }
 }finally{r.w.dispose();r.data.stop();}
});
