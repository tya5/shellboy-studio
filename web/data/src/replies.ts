import { signal, type ReadonlySignal } from "@preact/signals-core";
import type { Outcome } from "./errors";

/** Optional cross-Thread inbox adapter; per-Thread protocol-5 duties use thread.get. */
export interface ReplyWait {
  id: string;
  threadId: string;
  question: string;
  recipient: { kind: "human" } | { kind: "thread"; threadId: string; title: string };
  state: string;
  createdAt?: string;
  elapsedMs?: number;
}
export interface ReplyWaitAdapter {
  supported(capabilities: readonly string[]): boolean;
  readonly items: ReadonlySignal<readonly ReplyWait[]>;
  answer(id: string, text: string): Promise<Outcome<unknown>>;
}
export const noReplyWait: ReplyWaitAdapter = {
  supported: () => false,
  items: signal<readonly ReplyWait[]>([]),
  answer: async () => ({ ok: false, error: { kind: "bridge", code: "not_available", message: "reply waiting is not available" } }),
};

// Core 6560942 src/protocol.rs:18; src/control/reply.rs reads one overflow row.
const MAX_PENDING_REPLY_DUTIES = 16;
export interface ThreadReplyProjection { readonly items: readonly ReplyWait[]; readonly complete: boolean; }

export function adapterThreadReplies(adapter: ReplyWaitAdapter, threadId: string): ThreadReplyProjection {
  return { items: adapter.items.value.filter(item => item.threadId === threadId), complete: false };
}

/** Decode only protocol 5's unified bounded projection; never merge removed legacy lists. */
export function decodeThreadReplies(threadId: string, raw: unknown): ThreadReplyProjection | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_PENDING_REPLY_DUTIES + 1) return undefined;
  const items = raw.flatMap((value: unknown): ReplyWait[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.message_id !== "string" || typeof item.excerpt !== "string" || typeof item.delivery_status !== "string") return [];
    const recipient = item.recipient_kind === "human" ? { kind: "human" as const }
      : item.recipient_kind === "thread" && typeof item.recipient_thread_id === "string"
        ? { kind: "thread" as const, threadId: item.recipient_thread_id, title: item.recipient_thread_id } : undefined;
    return recipient ? [{ id: item.message_id, threadId, question: item.excerpt, recipient, state: item.delivery_status, ...(typeof item.created_at === "string" ? { createdAt: item.created_at } : {}), ...(typeof item.elapsed_ms === "number" && Number.isFinite(item.elapsed_ms) && item.elapsed_ms >= 0 ? { elapsedMs: item.elapsed_ms } : {}) }] : [];
  });
  return { items, complete: raw.length <= MAX_PENDING_REPLY_DUTIES && raw.length === items.length };
}
