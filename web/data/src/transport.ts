// Transport adapter: the only module that knows about WebSocket. The Tauri IPC adapter
// of the desktop app implements the same `Transport` interface.
import { parseServerFrame, type ClientFrame, type ServerFrame } from "./protocol";

export interface TransportHandlers {
  onOpen(): void;
  onFrame(frame: ServerFrame): void;
  onClose(): void;
  /** A frame that could not be decoded; reported, never dropped silently. */
  onInvalidFrame(reason: string): void;
}

export interface Transport {
  /** Begin connecting (and reconnecting) until `stop`. Calling twice is an error. */
  start(handlers: TransportHandlers): void;
  /** False when nothing was sent (not open). True means handed to the socket. */
  send(frame: ClientFrame): boolean;
  stop(): void;
}

/** The subset of the browser WebSocket used here (property handlers, like the browser). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export interface TimerApi {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface WebSocketTransportOptions {
  url: string | (() => string);
  createSocket?: (url: string) => SocketLike;
  timers?: TimerApi;
  /** Reconnect delay doubles from `initialMs` to `maxMs` (limits, not latency claims). */
  backoff?: { initialMs: number; maxMs: number };
}

const OPEN = 1;

interface BrowserGlobals {
  WebSocket?: new (url: string) => SocketLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  location?: { protocol: string; host: string };
}
const g = globalThis as unknown as BrowserGlobals;

/** `ws(s)://<host>/ws` for the page that served the app. Browser-only helper. */
export function defaultBridgeUrl(): string {
  if (!g.location) throw new Error("no location: pass an explicit bridge url");
  return `${g.location.protocol === "https:" ? "wss" : "ws"}://${g.location.host}/ws`;
}

export class WebSocketTransport implements Transport {
  private handlers: TransportHandlers | undefined;
  private socket: SocketLike | undefined;
  private timer: unknown;
  private delay: number;
  private stopped = false;
  private readonly opts: Required<Pick<WebSocketTransportOptions, "backoff">> &
    WebSocketTransportOptions;

  constructor(options: WebSocketTransportOptions) {
    this.opts = { backoff: { initialMs: 1000, maxMs: 10000 }, ...options };
    this.delay = this.opts.backoff.initialMs;
  }

  start(handlers: TransportHandlers): void {
    if (this.handlers) throw new Error("transport already started");
    this.handlers = handlers;
    this.stopped = false;
    this.connect();
  }

  send(frame: ClientFrame): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(JSON.stringify(frame));
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.timers().clear(this.timer);
    this.timer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      this.handlers?.onClose();
    }
    this.handlers = undefined;
  }

  private timers(): TimerApi {
    return (
      this.opts.timers ?? {
        set: (fn, ms) => g.setTimeout?.(fn, ms),
        clear: (h) => g.clearTimeout?.(h),
      }
    );
  }

  private connect(): void {
    const { url, createSocket } = this.opts;
    const target = typeof url === "function" ? url() : url;
    const socket = createSocket
      ? createSocket(target)
      : (() => {
          if (!g.WebSocket) throw new Error("no WebSocket: pass createSocket");
          return new g.WebSocket(target);
        })();
    this.socket = socket;
    socket.onopen = () => {
      if (this.stopped || this.socket !== socket) return;
      this.delay = this.opts.backoff.initialMs;
      this.handlers?.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.stopped || this.socket !== socket) return;
      if (typeof event.data !== "string") {
        this.handlers?.onInvalidFrame("binary frame");
        return;
      }
      const parsed = parseServerFrame(event.data);
      if (parsed.ok) this.handlers?.onFrame(parsed.frame);
      else this.handlers?.onInvalidFrame(parsed.reason);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.handlers?.onClose();
      if (this.stopped) return;
      const wait = this.delay;
      this.delay = Math.min(this.delay * 2, this.opts.backoff.maxMs);
      this.timer = this.timers().set(() => {
        this.timer = undefined;
        if (!this.stopped) this.connect();
      }, wait);
    };
    socket.onerror = () => {
      // `close` follows an error; reconnection is driven from there.
    };
  }
}
