// One shared bridge connection: call correlation, a bounded call scheduler, frame fan-out.
// No view logic here; the store (store.ts) interprets frames.
import { signal, type ReadonlySignal } from "@preact/signals-core";
import { fromBridgeError, type OpError } from "./errors";
import type { ClientFrame, OwnerResponse, ServerFrame } from "./protocol";
import type { Transport } from "./transport";

/**
 * Calls on the wire at once. Equals the bridge's per-session running bound
 * (`ws::SESSION_IN_FLIGHT` = 4), so the bridge never has to queue or answer `busy`
 * for this client. A limit, not a performance claim.
 */
export const MAX_IN_FLIGHT = 4;
/** Calls waiting here (queued + in flight). Beyond it a call fails locally with `busy`. */
export const MAX_OUTSTANDING = 256;

export type ConnectionState = "connecting" | "open" | "closed";

export type LinkEvent =
  | { kind: "open" }
  | { kind: "closed" }
  | { kind: "frame"; frame: Exclude<ServerFrame, { t: "result" }> }
  | { kind: "invalid_frame"; reason: string };

export type CallReply =
  | { ok: true; response: OwnerResponse }
  | { ok: false; error: OpError };

export interface CallOptions {
  /** Present for mutations. Sent as `operation_id` and reused on retry. */
  operationId?: string;
  /** Mutations jump ahead of queued reads. */
  mutation?: boolean;
  /** Called when the call is written to the socket (it can no longer be dropped silently). */
  onSent?: () => void;
  /**
   * A call that waits for something and holds no owner connection, such as an app's change hints. It goes
   * out at once and doesn't take one of the `MAX_IN_FLIGHT` slots, which would starve ordinary reads.
   */
  waits?: boolean;
}

export interface CallHandle {
  promise: Promise<CallReply>;
  /** Drop the call. A call already sent also gets a `cancel` frame; its result is discarded. */
  cancel(): void;
}

interface Pending {
  id: number;
  frame: ClientFrame & { t: "call" };
  mutation: boolean;
  operationId?: string;
  onSent?: () => void;
  sent: boolean;
  resolve: (r: CallReply) => void;
}

export class Link {
  private nextId = 1;
  private queue: Pending[] = [];
  private inFlight = new Map<number, Pending>();
  /** Those in `inFlight` that don't count against `MAX_IN_FLIGHT`. */
  private waiting = new Set<number>();
  private listeners = new Set<(e: LinkEvent) => void>();
  private readonly conn = signal<ConnectionState>("closed");
  private readonly failed = signal(0);
  private started = false;

  constructor(private readonly transport: Transport) {}

  /** Connection to the bridge (not to the owner; see the store's `owner`). */
  get connection(): ReadonlySignal<ConnectionState> {
    return this.conn;
  }
  /** Consecutive closes without an open in between; a presentation may show a token prompt. */
  get failedAttempts(): ReadonlySignal<number> {
    return this.failed;
  }

  subscribe(listener: (e: LinkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.conn.value = "connecting";
    this.transport.start({
      onOpen: () => {
        this.conn.value = "open";
        this.failed.value = 0;
        this.emit({ kind: "open" });
      },
      onClose: () => this.onClose(),
      onInvalidFrame: (reason) => this.emit({ kind: "invalid_frame", reason }),
      onFrame: (frame) => {
        if (frame.t === "result") this.onResult(frame);
        else this.emit({ kind: "frame", frame });
      },
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.transport.stop();
    this.conn.value = "closed";
  }

  /** Replace this tab's subscription. Dropped if not open: the store re-sends on open. */
  watch(threadIds: string[], list: boolean): boolean {
    return this.transport.send({ t: "watch", thread_ids: threadIds, list });
  }

  call(command: string, args: unknown, options: CallOptions = {}): CallHandle {
    const mutation = options.mutation ?? options.operationId !== undefined;
    let resolve!: (r: CallReply) => void;
    const promise = new Promise<CallReply>((r) => (resolve = r));
    const fail = (error: OpError): CallHandle => {
      resolve({ ok: false, error });
      return { promise, cancel() {} };
    };
    if (this.conn.value !== "open")
      return fail({ kind: "not_connected", message: "not connected to the bridge" });
    if (this.queue.length + this.inFlight.size >= MAX_OUTSTANDING)
      return fail({ kind: "busy", message: "too many calls waiting" });
    const id = this.nextId++;
    const frame: ClientFrame & { t: "call" } = { t: "call", id, command, args };
    if (options.operationId !== undefined) frame.operation_id = options.operationId;
    const p: Pending = {
      id,
      frame,
      mutation,
      sent: false,
      resolve,
      ...(options.operationId !== undefined && { operationId: options.operationId }),
      ...(options.onSent && { onSent: options.onSent }),
    };
    if (mutation) {
      // Behind earlier queued mutations, ahead of reads.
      let at = 0;
      while (at < this.queue.length && this.queue[at]!.mutation) at++;
      this.queue.splice(at, 0, p);
    } else this.queue.push(p);
    if (options.waits) {
      this.queue.pop();
      this.inFlight.set(id, p);
      this.waiting.add(id);
      if (!this.transport.send(p.frame)) {
        this.inFlight.delete(id);
        this.waiting.delete(id);
        return fail({ kind: "not_connected", message: "not connected to the bridge" });
      }
      p.sent = true;
    } else this.pump();
    return {
      promise,
      cancel: () => {
        const q = this.queue.indexOf(p);
        if (q >= 0) this.queue.splice(q, 1);
        else if (this.inFlight.delete(id)) {
          this.waiting.delete(id);
          this.transport.send({ t: "cancel", id });
          this.pump();
        } else return;
        resolve({ ok: false, error: { kind: "cancelled", message: "cancelled" } });
      },
    };
  }

  private pump(): void {
    while (this.inFlight.size - this.waiting.size < MAX_IN_FLIGHT && this.queue.length > 0) {
      const p = this.queue.shift()!;
      this.inFlight.set(p.id, p);
      if (!this.transport.send(p.frame)) {
        // Closed between check and send: nothing reached the bridge.
        this.inFlight.delete(p.id);
        p.resolve({ ok: false, error: { kind: "not_connected", message: "not connected to the bridge" } });
        continue;
      }
      p.sent = true;
      p.onSent?.();
    }
  }

  private onResult(frame: Extract<ServerFrame, { t: "result" }>): void {
    const p = this.inFlight.get(frame.id);
    if (!p) return; // cancelled or unknown: discard
    this.inFlight.delete(frame.id);
    this.waiting.delete(frame.id);
    if (frame.error) p.resolve({ ok: false, error: fromBridgeError(frame.error) });
    else if (frame.response) p.resolve({ ok: true, response: frame.response });
    else
      p.resolve({
        ok: false,
        error: { kind: "invalid_response", message: "result without response or error" },
      });
    this.pump();
  }

  private onClose(): void {
    this.conn.value = this.started ? "connecting" : "closed";
    this.failed.value += 1;
    const lost = [...this.inFlight.values()];
    const queued = this.queue;
    this.inFlight.clear();
    this.waiting.clear();
    this.queue = [];
    for (const p of lost)
      p.resolve({
        ok: false,
        error:
          p.mutation && p.operationId !== undefined
            ? {
                kind: "unconfirmed",
                message: "connection lost before the reply; the mutation may have been applied",
                operationId: p.operationId,
              }
            : { kind: "connection_lost", message: "connection lost before the reply" },
      });
    for (const p of queued)
      p.resolve({ ok: false, error: { kind: "not_connected", message: "connection closed before sending" } });
    this.emit({ kind: "closed" });
  }

  private emit(e: LinkEvent): void {
    for (const l of [...this.listeners]) l(e);
  }
}
