import { describe, expect, it } from "vitest";
import type { ClientFrame } from "../src/protocol";
import { WebSocketTransport, type SocketLike, type TransportHandlers } from "../src/transport";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  fail() {
    this.readyState = 3;
    this.onerror?.();
    this.onclose?.();
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const events: string[] = [];
  const transport = new WebSocketTransport({
    url: () => "ws://x/ws",
    createSocket: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    timers: {
      set: (fn, ms) => {
        const t = { fn, ms, live: true };
        timers.push(t);
        return t;
      },
      clear: (h) => {
        if (h) (h as { live: boolean }).live = false;
      },
    },
  });
  const handlers: TransportHandlers = {
    onOpen: () => events.push("open"),
    onClose: () => events.push("close"),
    onFrame: (f) => events.push(`frame:${f.t}`),
    onInvalidFrame: (r) => events.push(`invalid:${r}`),
  };
  return { transport, sockets, timers, events, handlers };
}

describe("WebSocketTransport", () => {
  it("delivers frames, reports invalid ones, and refuses to send while not open", () => {
    const { transport, sockets, events, handlers } = setup();
    const frame: ClientFrame = { t: "watch", thread_ids: [], list: true };
    transport.start(handlers);
    expect(transport.send(frame)).toBe(false);
    sockets[0]!.open();
    expect(transport.send(frame)).toBe(true);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual(frame);
    sockets[0]!.onmessage!({ data: '{"t":"resync"}' });
    sockets[0]!.onmessage!({ data: "{" });
    sockets[0]!.onmessage!({ data: new ArrayBuffer(1) });
    expect(events).toEqual(["open", "frame:resync", "invalid:not JSON", "invalid:binary frame"]);
  });

  it("reconnects with doubling delay up to the cap, and resets after an open", () => {
    const { transport, sockets, timers, handlers } = setup();
    transport.start(handlers);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      sockets.at(-1)!.fail();
      const t = timers.at(-1)!;
      delays.push(t.ms);
      t.fn();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    sockets.at(-1)!.open();
    sockets.at(-1)!.fail();
    expect(timers.at(-1)!.ms).toBe(1000);
  });

  it("stop closes the socket, cancels the retry timer and never reconnects", () => {
    const { transport, sockets, timers, events, handlers } = setup();
    transport.start(handlers);
    sockets[0]!.fail();
    const pending = timers.at(-1)!;
    transport.stop();
    expect(pending.live).toBe(false);
    expect(sockets).toHaveLength(1);

    const second = setup();
    second.transport.start(second.handlers);
    second.sockets[0]!.open();
    second.transport.stop();
    expect(second.sockets[0]!.closed).toBe(true);
    expect(second.events).toEqual(["open", "close"]);
    expect(events).toEqual(["close"]);
  });

  it("refuses a second start", () => {
    const { transport, handlers } = setup();
    transport.start(handlers);
    expect(() => transport.start(handlers)).toThrow();
  });
});

describe("socket callback ownership", () => {
  it("ignores old open/message callbacks after replacement and accepts current callbacks", () => {
    const { transport, sockets, timers, events, handlers } = setup();
    transport.start(handlers);
    const old = sockets[0]!;
    const open = old.onopen!;
    const message = old.onmessage!;
    old.fail();
    timers.at(-1)!.fn();
    const current = sockets[1]!;
    open();
    message({ data: '{"t":"resync"}' });
    message({ data: "{" });
    message({ data: new ArrayBuffer(1) });
    expect(events).toEqual(["close"]);
    current.open();
    current.onmessage!({ data: '{"t":"resync"}' });
    expect(events).toEqual(["close", "open", "frame:resync"]);
    transport.stop();
  });

  it("ignores callbacks retained before stop, including after a new start", () => {
    const { transport, sockets, events, handlers } = setup();
    transport.start(handlers);
    const open = sockets[0]!.onopen!;
    const message = sockets[0]!.onmessage!;
    transport.stop();
    open(); message({ data: '{"t":"resync"}' });
    expect(events).toEqual(["close"]);
    transport.start(handlers);
    open(); message({ data: '{"t":"resync"}' });
    expect(events).toEqual(["close"]);
    sockets[1]!.open();
    expect(events).toEqual(["close", "open"]);
    transport.stop();
  });

  it("does not let an old open reset current reconnect backoff", () => {
    const { transport, sockets, timers, handlers } = setup();
    transport.start(handlers);
    const oldOpen = sockets[0]!.onopen!;
    sockets[0]!.fail(); timers.at(-1)!.fn();
    oldOpen();
    sockets[1]!.fail();
    expect(timers.at(-1)!.ms).toBe(2000);
    transport.stop();
  });
});

import {MAX_SERVER_FRAME_BYTES} from '../src/protocol';
import {Link} from '../src/link';
it.each(['normal','throw','stop','replace'] as const)('N2 oversize callback %s never dispatches or closes a replacement',mode=>{
 const h=setup();h.handlers.onInvalidFrame=()=>{
  h.events.push('invalid');
  if(mode==='throw')throw new Error('observer');
  if(mode==='stop')h.transport.stop();
  if(mode==='replace'){h.transport.stop();h.transport.start({...h.handlers,onInvalidFrame:()=>{}});}
 };
 h.transport.start(h.handlers);const old=h.sockets[0]!;old.open();
 const deliver=()=>old.onmessage?.({data:'x'.repeat(MAX_SERVER_FRAME_BYTES+1)});
 if(mode==='throw')expect(deliver).toThrow('observer');else deliver();
 expect(h.events.filter(e=>e==='close')).toHaveLength(1);
 expect(h.events.some(e=>e.startsWith('frame:'))).toBe(false);
 expect(old.closed).toBe(true);
 if(mode==='replace')expect(h.sockets[1]!.closed).toBe(false);
 old.onclose?.();expect(h.events.filter(e=>e==='close')).toHaveLength(1);
 expect(h.timers.filter(t=>t.live)).toHaveLength(mode==='normal'||mode==='throw'?1:0);
});
it('N2 rejected frame settles pending reads/mutations once without replacing prior body',async()=>{
 const h=setup();const link=new Link(h.transport);link.start();const socket=h.sockets[0]!;socket.open();
 const oldBody='previous saved body';let body=oldBody;
 link.subscribe(e=>{if(e.kind==='frame')body='unexpected';});
 const read=link.call('history.get',{node_id:'saved'});
 const mutation=link.call('message.send',{}, {mutation:true,operationId:'stable-op'});
 socket.onmessage?.({data:'x'.repeat(MAX_SERVER_FRAME_BYTES+1)});
 expect(await read.promise).toMatchObject({ok:false,error:{kind:'connection_lost'}});
 expect(await mutation.promise).toMatchObject({ok:false,error:{kind:'unconfirmed',operationId:'stable-op'}});
 expect(body).toBe(oldBody);
 expect(h.timers.filter(t=>t.live)).toHaveLength(1);
 link.stop();
});
it('N2 binary types retain rejection without conversion',()=>{
 const h=setup();h.transport.start(h.handlers);h.sockets[0]!.open();
 for(const data of [new ArrayBuffer(1),new Blob(['x'])])h.sockets[0]!.onmessage?.({data});
 expect(h.events.filter(e=>e==='invalid:binary frame')).toHaveLength(2);
 expect(h.sockets[0]!.closed).toBe(false);
});
