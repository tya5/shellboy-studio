import { expect, it } from 'vitest';
import { readThreadSettings } from '../src/resources';
import { CONFIG_FIELDS } from '../src/config';
it('reads explicit and effective output limits without guessing a provider default or old summary fields',()=>{
 expect(readThreadSettings({max_tokens:4096,effective_max_tokens:4096})).toMatchObject({maxTokens:4096,effectiveMaxTokens:4096});
 expect(readThreadSettings({max_tokens:null,effective_max_tokens:8192})).toMatchObject({maxTokens:undefined,effectiveMaxTokens:8192});
 const unset=readThreadSettings({});expect(unset).toMatchObject({maxTokens:undefined,effectiveMaxTokens:undefined});
 expect(Object.keys(unset)).not.toContain('segmentChars');expect(Object.keys(unset)).not.toContain('reduceRounds');
});
it('does not expose any strict-retired config key',()=>{
 for(const key of ['compaction.segment_chars','compaction.reduce_rounds','compaction.summary_map_max_requests','compaction.summary_reduce_max_requests','compaction.summary_max_percent'])expect(Object.keys(CONFIG_FIELDS)).not.toContain(key);
});
it.each([0,-1,1.5,'4096',Number.NaN,Number.MAX_SAFE_INTEGER+1])('does not invent a configured/effective output limit from invalid readback %j',value=>{
 expect(readThreadSettings({max_tokens:value,effective_max_tokens:value})).toMatchObject({maxTokens:undefined,effectiveMaxTokens:undefined});
});

it('distinguishes unknown or unrepresentable limit readback from genuinely unset',()=>{
 expect(readThreadSettings({max_tokens:9007199254740992,effective_max_tokens:9007199254740992})).toMatchObject({maxTokensState:{kind:'unknown'},effectiveMaxTokensState:{kind:'unknown'}});
 expect(readThreadSettings({max_tokens:null})).toMatchObject({maxTokensState:{kind:'unset'}});
 expect(readThreadSettings({max_tokens:4096})).toMatchObject({maxTokensState:{kind:'value',value:4096}});
});
