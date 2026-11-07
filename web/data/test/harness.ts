import type { ClientFrame, OwnerResponse, OwnerState, ServerFrame } from "../src/protocol";
import type { Transport, TransportHandlers } from "../src/transport";

export type CallFrame = Extract<ClientFrame, { t: "call" }>;

/** A transport double: tests push server frames and inspect what the client sent. */
export class FakeTransport implements Transport {
  handlers: TransportHandlers | undefined;
  isOpen = false;
  sent: ClientFrame[] = [];

  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  send(frame: ClientFrame): boolean {
    if (!this.isOpen) return false;
    this.sent.push(frame);
    return true;
  }
  stop(): void {
    this.isOpen = false;
    this.handlers = undefined;
  }

  open(): void {
    this.isOpen = true;
    this.handlers!.onOpen();
  }
  drop(): void {
    this.isOpen = false;
    this.handlers!.onClose();
  }
  push(frame: ServerFrame): void {
    this.handlers!.onFrame(frame);
  }

  calls(command?: string): CallFrame[] {
    return this.sent.filter((f): f is CallFrame => f.t === "call" && (!command || f.command === command));
  }
  watches(): Extract<ClientFrame, { t: "watch" }>[] {
    return this.sent.filter((f): f is Extract<ClientFrame, { t: "watch" }> => f.t === "watch");
  }
  cancels(): number[] {
    return this.sent.flatMap((f) => (f.t === "cancel" ? [f.id] : []));
  }

  ok(id: number, result: unknown): void {
    this.push({ t: "result", id, response: okResponse(result) });
  }
  ownerError(id: number, code: string, message = code, details?: unknown): void {
    this.push({
      t: "result",
      id,
      response: { protocol_version: 2, operation_id: "x", ok: false, error: { code, message, ...(details !== undefined && { details }) } },
    });
  }
}

export const okResponse = (result: unknown): OwnerResponse => ({
  protocol_version: 2,
  operation_id: "op",
  ok: true,
  result,
});

export const connected: OwnerState = { state: "connected", info: { protocol_version: 2, instance_id: "i1", capabilities: [] } };

export function summary(id: string, extra: Record<string, unknown> = {}) {
  return { thread_id: id, title: `t-${id}`, cwd: "/", state: "idle", activity: "idle", updated_at: "u", excerpt: "", ...extra };
}
export function details(id: string, extra: Record<string, unknown> = {}) {
  return { thread_id: id, title: `t-${id}`, cwd: "/", connection: "c", model: "m", children_count: 0, shells_count: 0, ...extra };
}

/** Let promise continuations run (no timers involved). */
export const flush = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** Saved facts held by a fake owner; reads return the current content. */
export class FakeOwnerDb {
  threads: Record<string, ReturnType<typeof summary>> = {};
  details: Record<string, ReturnType<typeof details>> = {};
  history: Record<string, Record<string, unknown>[]> = {};
  expiredCursors = new Set<string>();
  shells: Record<string, Record<string, unknown>[]> = {};
  outputs: Record<string, string> = {};
  bodies: Record<string, string> = {};
  answered = new Set<number>();
  reads: string[] = [];

  answer(c: CallFrame): { ok: true; result: unknown } | { ok: false; code: string; message?: string; details?: unknown } {
    const a = (c.args ?? {}) as Record<string, string>;
    this.reads.push(`${c.command}${a.thread_id ? ":" + a.thread_id : ""}${a.cursor ? "@" + a.cursor : ""}`);
    switch (c.command) {
      case "thread.list":
        return { ok: true, result: { items: Object.values(this.threads), ...(a.cursor ? {} : {}) } };
      case "thread.get":
        return this.details[a.thread_id!] ? { ok: true, result: this.details[a.thread_id!] } : { ok: false, code: "not_found" };
      case "history.list": {
        // Like the owner: oldest first, `since` inclusive, cursors continue towards the newest.
        const since = a.since;
        const all = (this.history[a.thread_id!] ?? []).filter(
          (i) => since === undefined || String((i.provenance as { created_at?: string } | undefined)?.created_at) >= since,
        );
        if (a.cursor && this.expiredCursors.has(a.cursor)) return { ok: false, code: "cursor_expired" };
        const start = a.cursor ? Number(a.cursor) : 0;
        const limit = Number(a.limit ?? 50);
        const end = start + limit;
        return { ok: true, result: { items: all.slice(start, end), ...(end < all.length ? { next_cursor: String(end) } : {}) } };
      }
      case "shell.list":
        return { ok: true, result: { items: this.shells[a.thread_id!] ?? [] } };
      case "shell.read":
        return { ok: true, result: { execution_id: a.execution_id, text: this.outputs[a.execution_id!] ?? "", output_complete: true } };
      case "history.get":
        return { ok: true, result: { node_id: a.node_id, kind: "assistant_response", text: this.bodies[a.node_id!] ?? "" } };
      default:
        return { ok: true, result: {} };
    }
  }
}

/** Answer every unanswered call from the db until none are left. */
export async function settle(t: FakeTransport, db: FakeOwnerDb): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const todo = t.calls().filter((c) => !db.answered.has(c.id));
    if (todo.length === 0) {
      await flush();
      if (t.calls().every((c) => db.answered.has(c.id))) return;
      continue;
    }
    for (const c of todo) {
      db.answered.add(c.id);
      const r = db.answer(c);
      if (r.ok) t.ok(c.id, r.result);
      else t.ownerError(c.id, r.code, r.message ?? r.code, r.details);
    }
    await flush();
  }
  throw new Error("settle did not converge");
}
