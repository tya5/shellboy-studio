// An owner double for `history.window`, behind the data layer's fake transport.
import { connected, FakeTransport, flush, type CallFrame } from "../../data/test/harness";
import { ShellboyData, type ThreadHandle } from "../../data/src";
import { ConversationWindow, type WindowOptions } from "../src/window";

export class WindowOwner {
  revision = 1;
  /** Node ids along the selected path; a generation tag makes a rewritten path distinguishable. */
  gen = 0;
  total: number;
  hiddenEvery = 7;
  answered = new Set<number>();
  constructor(total: number) {
    this.total = total;
  }
  nodeId = (i: number): string => `n${this.gen}-${i}`;
  append(n: number): void {
    this.total += n;
    this.revision++;
  }
  /** A rewind or compaction: the path from `from` on is different. */
  rewrite(newTotal: number, from = 0): void {
    this.gen++;
    this.total = newTotal;
    this.revision++;
    void from;
  }
  private item(i: number) {
    const kind = i % this.hiddenEvery === 3 ? "event" : i % 2 ? "assistant_response" : "user";
    return {
      node_id: this.nodeId(i),
      kind,
      excerpt: `text ${i}`,
      provenance: { created_at: "2026-11-07T10:00:00+00:00", sender: { kind: "human" } },
      selection: { ordinal: i },
    };
  }
  answer(c: CallFrame): { ok: true; result: unknown } | { ok: false; code: string; details?: unknown } {
    if (c.command !== "history.window") return { ok: true, result: {} };
    const a = c.args as { ordinal?: number; node_id?: string; expect_node_id?: string; before?: number; after?: number };
    const before = a.before ?? 20;
    const after = a.after ?? 20;
    const stale = { ok: false as const, code: "cursor_expired", details: { revision: this.revision, total: this.total } };
    let at = this.total - 1;
    let from: number;
    let to: number;
    if (a.node_id !== undefined) {
      const m = /^n(\d+)-(\d+)$/.exec(a.node_id);
      if (!m || Number(m[1]) !== this.gen || Number(m[2]) >= this.total) return { ok: false, code: "not_found" };
      at = Number(m[2]);
      from = at - before;
      to = at + after;
    } else if (a.ordinal !== undefined) {
      if (a.ordinal >= this.total) return stale;
      if (a.expect_node_id !== undefined && a.expect_node_id !== this.nodeId(a.ordinal)) return stale;
      from = a.ordinal - before;
      to = a.ordinal + after;
    } else {
      from = at - before;
      to = at;
    }
    from = Math.max(0, from);
    to = Math.min(this.total - 1, to);
    const items = [];
    for (let i = from; i <= to; i++) items.push(this.item(i));
    return { ok: true, result: { thread_id: "t", revision: this.revision, total: this.total, items } };
  }
}

export interface Rig {
  t: FakeTransport;
  owner: WindowOwner;
  handle: ThreadHandle;
  data: ShellboyData;
  w: ConversationWindow;
  /** Fire the pause timer, if one is armed. */
  pause(): void;
  /** Answer every unanswered call from the owner. */
  settle(): Promise<void>;
  calls(): CallFrame[];
  /** Window calls sent since the mark. */
  since(mark: number): CallFrame[];
}

export async function rig(total: number, options: { capability?: boolean } = {}): Promise<Rig> {
  const t = new FakeTransport();
  const data = new ShellboyData({ transport: t, newId: () => "id" });
  data.start();
  t.open();
  if (connected.state !== "connected") throw new Error("fixture");
  const info = { ...connected, info: { ...connected.info, capabilities: options.capability === false ? [] : ["history.window"] } };
  t.push({ t: "hello", bridge_version: "0.1.0", owner: info });
  await flush();
  const owner = new WindowOwner(total);
  const handle = data.openThread("t");
  let armed: (() => void) | undefined;
  const opts: WindowOptions = {
    setTimer: (fn) => {
      armed = fn;
      return () => {
        if (armed === fn) armed = undefined;
      };
    },
  };
  const w = new ConversationWindow({ read: (a, c) => handle.readWindow(a, c) }, opts);
  const calls = () => t.calls("history.window");
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await flush();
      const todo = t.calls().filter((c) => !owner.answered.has(c.id));
      if (todo.length === 0) return;
      for (const c of todo) {
        owner.answered.add(c.id);
        const r = owner.answer(c);
        if (r.ok) t.ok(c.id, r.result);
        else t.ownerError(c.id, r.code, r.code, r.details);
      }
    }
  };
  return {
    t, owner, handle, data, w,
    pause: () => {
      const f = armed;
      armed = undefined;
      f?.();
    },
    settle,
    calls,
    since: (mark) => calls().slice(mark),
  };
}
