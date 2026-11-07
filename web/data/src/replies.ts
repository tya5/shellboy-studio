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
