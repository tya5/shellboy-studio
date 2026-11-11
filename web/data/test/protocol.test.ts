import { describe, expect, it } from "vitest";
import { parseServerFrame } from "../src/protocol";

const j = (v: unknown) => JSON.stringify(v);

describe("parseServerFrame", () => {
  it("accepts every frame the bridge defines", () => {
    const owner = { state: "connected", info: { protocol_version: 5, instance_id: null, capabilities: [] } };
    for (const f of [
      { t: "hello", bridge_version: "0.1.0", owner },
      { t: "hello", bridge_version: "0.1.0", owner: { state: "unreachable" } },
      { t: "result", id: 1, response: { protocol_version: 5, operation_id: "a", ok: true, result: {} } },
      { t: "result", id: 1, error: { code: "busy", message: "m" } },
      { t: "changed", thread_ids: ["a"], list: false },
      { t: "live", thread_id: "a", attempt_id: "x", gap: false, deltas: [{ offset: 0, reasoning: false, text: "x" }] },
      { t: "live", thread_id: "a", attempt_id: "x", gap: true, deltas: [] },
      { t: "live_end", thread_id: "a" },
      { t: "resync" },
      { t: "owner", event: "restarted", owner },
      { t: "error", error: { code: "invalid_frame", message: "m" } },
    ])
      expect(parseServerFrame(j(f)).ok, j(f)).toBe(true);
  });

  it("reports, rather than guesses at, malformed or unknown frames", () => {
    for (const bad of [
      "not json",
      j([]),
      j({}),
      j({ t: "mystery" }),
      j({ t: "changed", thread_ids: "a", list: true }),
      j({ t: "stream", thread_id: "a", cursor: "c", text: "", gap: false }),
      j({ t: "live", thread_id: "a", attempt_id: "x", gap: false, deltas: [{ offset: "0", reasoning: false, text: "" }] }),
      j({ t: "live", thread_id: "a", attempt_id: "x", gap: false }),
      j({ t: "live_end" }),
      j({ t: "result", id: 1 }),
      j({ t: "owner", event: "exploded", owner: { state: "unreachable" } }),
    ]) {
      const r = parseServerFrame(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
});

import {vi} from 'vitest';
import {MAX_SERVER_FRAME_BYTES,exceedsServerFrameBytes} from '../src/protocol';
it.each([-1,0,1])('N2 exact global UTF8 boundary %i',offset=>{
 // Derive padding from the exact serialized shell rather than assume its bytes.
 const shell='{"t":"resync","pad":""}';
 const text=shell.slice(0,-2)+'x'.repeat(MAX_SERVER_FRAME_BYTES-shell.length+offset)+'"}';
 expect(exceedsServerFrameBytes(text)).toBe(offset>0);
 expect(parseServerFrame(text).ok).toBe(offset<=0);
});
it.each(['界','😀','\ud800','\udc00'])('N2 UTF8 accounting agrees with bounded encoder oracle %j',unit=>{
 const size=new TextEncoder().encode(unit).length;
 const base=unit.repeat(Math.floor(MAX_SERVER_FRAME_BYTES/size));
 expect(exceedsServerFrameBytes(base)).toBe(false);
 expect(exceedsServerFrameBytes(base+'x'.repeat(MAX_SERVER_FRAME_BYTES%size+1))).toBe(true);
});
it('N2 oversized input never reaches JSON.parse',()=>{
 const spy=vi.spyOn(JSON,'parse');
 try {expect(parseServerFrame('x'.repeat(MAX_SERVER_FRAME_BYTES+1))).toMatchObject({ok:false,code:'frame_too_large'});expect(spy).not.toHaveBeenCalled();}
 finally {spy.mockRestore();}
});
it('N2 maximum u64 wrapper is a byte oracle, not JS ID precision qualification',()=>{
 const prefix='{"t":"result","id":18446744073709551615,"response":';
 const response='{"pad":"'+'x'.repeat(8388608-10)+'"}';
 expect(new TextEncoder().encode(prefix+'}').length).toBe(52);
 expect(new TextEncoder().encode(response).length).toBe(8388608);
 expect(parseServerFrame(prefix+response+'}').ok).toBe(true);
 expect(parseServerFrame(prefix+response+' }')).toMatchObject({ok:false,code:'frame_too_large'});
});
