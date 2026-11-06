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
