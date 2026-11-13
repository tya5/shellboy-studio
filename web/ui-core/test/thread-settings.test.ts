import { expect, it } from 'vitest';
import { fixtureModel, settle } from './fixture';
import { readThreadSettings } from '../src/resources';
import { CONFIG_FIELDS } from '../src/config';
it('reads explicit and effective output limits without guessing a provider default or old summary fields',()=>{
 expect(readThreadSettings({max_tokens:4096,effective_max_tokens:4096})).toMatchObject({maxTokens:4096,effectiveMaxTokens:4096});
 expect(readThreadSettings({max_tokens:null,effective_max_tokens:8192})).toMatchObject({maxTokens:undefined,effectiveMaxTokens:8192});
 const unset=readThreadSettings({});expect(unset).toMatchObject({maxTokens:undefined,effectiveMaxTokens:undefined});
 expect(Object.keys(unset)).not.toContain('segmentChars');expect(Object.keys(unset)).not.toContain('reduceRounds');
});
it('does not expose any strict-retired config key',()=>{
 for(const key of ['compaction.segment_chars','compaction.reduce_rounds','compaction.summary_map_max_requests','compaction.summary_reduce_max_requests'])expect(Object.keys(CONFIG_FIELDS)).not.toContain(key);
});
it('uses owner readback for set, reopen, explicit empty clear and inherited effective limit',async()=>{
 let own:number|null=null;
 const r=await fixtureModel({capabilities:['thread.settings'],configure(db){
  const detail=db.details.lead!;detail.max_tokens=own;detail.effective_max_tokens=8192;
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='thread.set'){
    const args=call.args as Record<string,unknown>;
    expect(args).not.toHaveProperty('segment_chars');expect(args).not.toHaveProperty('reduce_rounds');
    if('max_tokens' in args)own=args.max_tokens===''?null:Number(args.max_tokens);
    detail.max_tokens=own;detail.effective_max_tokens=own??8192;
    return {ok:true,result:detail};
   }return base(call);
  };
 }});
 try{
  r.model.openModelPicker();await settle(r.t,r.db);
  expect(r.model.modelPicker.peek()).toMatchObject({maxTokens:''});
  expect(r.model.effectiveThreadSettings.peek()).toMatchObject({maxTokens:8192});
  r.model.modelPicker.value={...r.model.modelPicker.peek(),maxTokens:'4096'};
  const save=r.model.saveThreadModel();await settle(r.t,r.db);await save;
  expect(r.t.calls('thread.set').at(-1)!.args).toMatchObject({max_tokens:'4096'});
  r.model.openModelPicker();await settle(r.t,r.db);
  expect(r.model.modelPicker.peek()).toMatchObject({maxTokens:'4096'});
  r.model.modelPicker.value={...r.model.modelPicker.peek(),maxTokens:''};
  const clear=r.model.saveThreadModel();await settle(r.t,r.db);await clear;
  expect(r.t.calls('thread.set').at(-1)!.args).toMatchObject({max_tokens:''});
  r.model.openModelPicker();await settle(r.t,r.db);
  expect(r.model.modelPicker.peek()).toMatchObject({maxTokens:''});
  expect(r.model.effectiveThreadSettings.peek()).toMatchObject({maxTokens:8192});
  const unchanged=r.model.saveThreadModel();await settle(r.t,r.db);await unchanged;
  expect(r.t.calls('thread.set').at(-1)!.args).not.toHaveProperty('max_tokens');
 }finally{r.model.dispose();r.data.stop();}
});
it('owner rejection preserves draft, observed settings and original error without retry',async()=>{
 const r=await fixtureModel({capabilities:['thread.settings'],configure(db){db.details.lead!.max_tokens=100;const base=db.answer.bind(db);db.answer=call=>call.command==='thread.set'?{ok:false,code:'config_invalid',message:'max_tokens conflicts with max_output_tokens'}:base(call);}});
 try{
  r.model.openModelPicker();await settle(r.t,r.db);r.model.modelPicker.value={...r.model.modelPicker.peek(),maxTokens:'200'};
  const save=r.model.saveThreadModel();await settle(r.t,r.db);await save;
  expect(r.model.modelPicker.peek()).toMatchObject({open:true,maxTokens:'200',error:'max_tokens conflicts with max_output_tokens'});
  expect(r.model.details.peek()!.max_tokens).toBe(100);expect(r.t.calls('thread.set')).toHaveLength(1);
 }finally{r.model.dispose();r.data.stop();}
});

it.each([0,-1,1.5,'4096',Number.NaN,Number.MAX_SAFE_INTEGER+1])('does not invent a configured/effective output limit from invalid readback %j',value=>{
 expect(readThreadSettings({max_tokens:value,effective_max_tokens:value})).toMatchObject({maxTokens:undefined,effectiveMaxTokens:undefined});
});
