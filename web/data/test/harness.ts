import type { PendingReply, ThreadDetails, ClientFrame, OwnerResponse, OwnerState, ServerFrame } from "../src/protocol";
import type { Transport, TransportHandlers } from "../src/transport";

export type CallFrame = Extract<ClientFrame, { t: "call" }>;

/** A transport double: tests push server frames and inspect what the client sent. */
export class FakeTransport implements Transport {
  handlers: TransportHandlers | undefined;
  isOpen = false;
  sent: ClientFrame[] = [];
  onCall?: (call: CallFrame) => void;

  start(handlers: TransportHandlers): void {
    this.handlers = handlers;
  }
  send(frame: ClientFrame): boolean {
    if (!this.isOpen) return false;
    this.sent.push(frame);
    if (frame.t === "call") this.onCall?.(frame);
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
export function details(id: string, extra: Record<string, unknown> = {}): ThreadDetails {
  return { thread_id: id, title: `t-${id}`, cwd: "/", connection: "c", model: "m", shells_count: 0, ...extra };
}

/** Let promise continuations run (no timers involved). */
export const flush = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

const tagsOf = (t: unknown): string[] => (t as { tags?: string[] }).tags ?? [];
const isArchived = (t: unknown): boolean => (t as { archived_at?: string }).archived_at !== undefined;

export function pendingReply(id: string, from: string, to: { kind: "name"; name: string } | { kind: "thread"; thread_id: string }, excerpt: string): PendingReply {
  return { message_id: id, asked_by: from, sender: { kind: "model", thread_id: from },
    recipient: to, excerpt, created_at: "2026-01-01T00:00:00Z" };
}

/** Saved facts held by a fake owner; reads return the current content. */
export class FakeOwnerDb {
  threads: Record<string, ReturnType<typeof summary>> = {};
  details: Record<string, ReturnType<typeof details>> = {};
  replies: PendingReply[] = [];
  history: Record<string, Record<string, unknown>[]> = {};
  historyRevisions: Record<string, number> = {};
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
      case "message.list": {
        const rows = this.replies.filter(reply => a.owed_by_thread_id !== undefined
          ? reply.recipient.kind === "thread" && reply.recipient.thread_id === a.owed_by_thread_id
          : a.asked_by_thread_id !== undefined ? reply.asked_by === a.asked_by_thread_id
          : reply.recipient.kind === "name" && reply.recipient.name === a.to);
        return this.page(rows, Number(a.limit), a.cursor);
      }
      case "thread.list": {
        const f = c.args as { thread_ids?: string[]; tags?: string[]; cwd?: string; limit?: number; cursor?: string; state?: string; archived?: "exclude" | "include" | "only" };
        if (f.thread_ids !== undefined) return { ok: true, result: { items: f.thread_ids.flatMap(id => this.threads[id] ? [this.threads[id]] : []) } };
        // Like the owner: archived Threads are excluded unless asked for (by-ID reads above include them).
        const archived = f.archived ?? "exclude";
        const scoped = Object.values(this.threads).filter(row => archived === "include" || (archived === "only") === isArchived(row));
        if (f.state !== undefined) return this.page(scoped.filter(row => row.state === f.state), f.limit, f.cursor);
        if (f.tags === undefined && f.cwd === undefined) return { ok: true, result: { items: scoped } };
        // Like the owner: every tag must match (AND), the cwd is exact, a cursor continues one filter.
        const matching = scoped.filter((t) => (f.tags ?? []).every((tag) => tagsOf(t).includes(tag)) && (f.cwd === undefined || t.cwd === f.cwd));
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
        const args = c.args as { thread_id: string; before?: number; after?: number; ordinal?: number; node_id?: string; expect_node_id?: string; revision?: number };
        const all = this.history[args.thread_id] ?? [];
        const total = all.length;
        const stale = { ok: false as const, code: "cursor_expired", details: { revision: this.historyRevisions[args.thread_id] ?? 1, total } };
        const nodeOrdinal = args.node_id === undefined ? undefined : all.findIndex(item => (item as {node_id?:string}).node_id === args.node_id);
        if (nodeOrdinal === -1 || (args.ordinal !== undefined && args.ordinal >= total)) return stale;
        const anchor = args.ordinal ?? nodeOrdinal ?? Math.max(0, total - 1);
        const selectedFirst = Math.max(0, anchor - (args.before ?? 0));
        const last = Math.min(total - 1, anchor + (args.after ?? 0));
        if (args.expect_node_id !== undefined && (all[anchor] as { node_id?: string } | undefined)?.node_id !== args.expect_node_id)
          return stale;
        const items = all.slice(selectedFirst, last + 1).map((item, index) => ({ ...item, selection: { ordinal: selectedFirst + index } }));
        return { ok: true, result: { thread_id: args.thread_id, revision: this.historyRevisions[args.thread_id] ?? 1, total, items } };
      }
      case "shell.list":
        return { ok: true, result: { items: this.shells[a.thread_id!] ?? [] } };
      case "shell.read":
        return { ok: true, result: { execution_id: a.execution_id, text: this.outputs[a.execution_id!] ?? "", output_complete: true } };
      case "history.read":
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
