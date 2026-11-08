import { signal, type ReadonlySignal } from "@preact/signals-core";
import type { Outcome } from "./errors";

/** The W6 wire is not yet adopted. Its adapter owns capability detection and bounded reads. */
export interface ReplyWait {
  id: string;
  threadId: string;
  question: string;
  recipient: { kind: "human" } | { kind: "thread"; threadId: string; title: string };
  state: string;
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

/** Decode only the bounded thread.get reply projection; old owners omit it. */
export function threadReplyItems(threadId: string, raw: unknown): ReplyWait[] {
  if (!Array.isArray(raw) || raw.length > 128) return [];
  return raw.flatMap((value: unknown): ReplyWait[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.message_id !== "string" || typeof item.excerpt !== "string" || typeof item.delivery_status !== "string") return [];
    const recipient = item.recipient_kind === "human" ? { kind: "human" as const }
      : item.recipient_kind === "thread" && typeof item.recipient_thread_id === "string"
        ? { kind: "thread" as const, threadId: item.recipient_thread_id, title: item.recipient_thread_id } : undefined;
    return recipient ? [{ id: item.message_id, threadId, question: item.excerpt, recipient, state: item.delivery_status }] : [];
  });
}
