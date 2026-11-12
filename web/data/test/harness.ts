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
      response: { protocol_version: 5, operation_id: "x", ok: false, error: { code, message, ...(details !== undefined && { details }) } },
    });
  }
}

export const okResponse = (result: unknown): OwnerResponse => ({
  protocol_version: 5,
  operation_id: "op",
  ok: true,
  result,
});

export const connected: OwnerState = { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: [] } };
export const connectedWithHistory: OwnerState = { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: ["history.window"] } };

export function summary(id: string, extra: Record<string, unknown> = {}) {
  return { thread_id: id, title: `t-${id}`, cwd: "/", state: "idle", activity: "idle", updated_at: "u", excerpt: "", ...extra };
}
export function details(id: string, extra: Record<string, unknown> = {}) {
  return { thread_id: id, title: `t-${id}`, cwd: "/", connection: "c", model: "m", shells_count: 0, ...extra };
}

/** Let promise continuations run (no timers involved). */
export const flush = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const tagsOf = (t: unknown): string[] => (t as { tags?: string[] }).tags ?? [];

/** Saved facts held by a fake owner; reads return the current content. */
export class FakeOwnerDb {
  threads: Record<string, ReturnType<typeof summary>> = {};
  details: Record<string, ReturnType<typeof details>> = {};
  history: Record<string, Record<string, unknown>[]> = {};
  expiredCursors = new Set<string>();
  shells: Record<string, Record<string, unknown>[]> = {};
  work: Record<string, Record<string, unknown>[]> = {};
  outputs: Record<string, string> = {};
  bodies: Record<string, string> = {};
  answered = new Set<number>();
  reads: string[] = [];

  /** A page of a list, like the owner's: `limit` items, and a cursor that continues the same list. */
  private page<T>(all: T[], limit: number | undefined, cursor: string | undefined): { ok: true; result: unknown } | { ok: false; code: string } {
    if (cursor !== undefined && this.expiredCursors.has(cursor)) return { ok: false, code: "cursor_expired" };
    const start = cursor ? Number(cursor) : 0;
    const end = start + (limit ?? 50);
    return { ok: true, result: { items: all.slice(start, end), ...(end < all.length ? { next_cursor: String(end) } : {}) } };
  }

  answer(c: CallFrame): { ok: true; result: unknown } | { ok: false; code: string; message?: string; details?: unknown } {
    const a = (c.args ?? {}) as Record<string, string>;
    this.reads.push(`${c.command}${a.thread_id ? ":" + a.thread_id : ""}${a.cursor ? "@" + a.cursor : ""}`);
    switch (c.command) {
      case "thread.list": {
        const f = c.args as { tags?: string[]; cwd?: string; limit?: number; cursor?: string };
        if (f.tags === undefined && f.cwd === undefined) return { ok: true, result: { items: Object.values(this.threads) } };
        // Like the owner: every tag must match (AND), the cwd is exact, a cursor continues one filter.
        const matching = Object.values(this.threads).filter((t) => (f.tags ?? []).every((tag) => tagsOf(t).includes(tag)) && (f.cwd === undefined || t.cwd === f.cwd));
        return this.page(matching, f.limit, f.cursor);
      }
      case "thread.tags":
        return this.page([...new Set(Object.values(this.threads).flatMap(tagsOf))].sort(), Number(a.limit), a.cursor);
      case "thread.cwds":
        return this.page([...new Set(Object.values(this.threads).map((t) => t.cwd))].sort(), Number(a.limit), a.cursor);
      case "thread.tag": {
        const f = c.args as { thread_ids: string[]; add?: string[]; remove?: string[] };
        const changed: string[] = [];
        const unchanged: string[] = [];
        const notFound: string[] = [];
        const next = new Map<string, string[]>();
        for (const id of f.thread_ids) {
          const t = this.threads[id];
          if (!t) {
            notFound.push(id);
            continue;
          }
          const now = new Set(tagsOf(t));
          for (const tag of f.add ?? []) now.add(tag);
          for (const tag of f.remove ?? []) now.delete(tag);
          if (now.size > 64) return { ok: false, code: "input_limit", message: "a Thread can have at most 64 tags" };
          next.set(id, [...now].sort());
          (JSON.stringify(next.get(id)) === JSON.stringify(tagsOf(t)) ? unchanged : changed).push(id);
        }
        for (const [id, tags] of next) (this.threads[id] as { tags?: string[] }).tags = tags;
        return { ok: true, result: { changed, unchanged, not_found: notFound, add: f.add ?? [], remove: f.remove ?? [] } };
      }
      case "status":
        return this.page(this.work[a.thread_id!] ?? [], Number(a.limit), a.cursor);
      case "thread.get":
        return this.details[a.thread_id!] ? { ok: true, result: this.details[a.thread_id!] } : { ok: false, code: "not_found" };
      case "history.window": {
        const args = c.args as { thread_id: string; before?: number; after?: number; ordinal?: number; expect_node_id?: string; revision?: string | number };
        const all = this.history[args.thread_id] ?? [];
        const total = all.length;
        let first = args.ordinal ?? Math.max(0, total - 1 - (args.before ?? 0));
        let last = Math.min(total - 1, first + (args.before ?? 0) + (args.after ?? 0));
        first = Math.max(0, first);
        if (args.expect_node_id !== undefined && (all[first] as { node_id?: string } | undefined)?.node_id !== args.expect_node_id)
          return { ok: false, code: "path_changed" };
        const items = all.slice(first, last + 1).map((item, index) => ({ ...item, selection: { ordinal: first + index } }));
        return { ok: true, result: { thread_id: args.thread_id, revision: args.revision ?? "fixture-revision", total, items } };
      }
      case "shell.list":
        return { ok: true, result: { items: this.shells[a.thread_id!] ?? [] } };
      case "shell.read":
        return { ok: true, result: { execution_id: a.execution_id, text: this.outputs[a.execution_id!] ?? "", output_complete: true } };
      case "history.get":
        return { ok: true, result: { node_id: a.node_id, kind: Object.values(this.work).some((rows) => rows.some((i) => i.message_id === a.node_id)) ? "user" : "assistant_response", text: this.bodies[a.node_id!] ?? "" } };
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
