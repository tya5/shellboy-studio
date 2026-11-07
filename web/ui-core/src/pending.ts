// "Awaiting you" source, isolated on purpose. `message ask` and pending counts (Shellboy #262)
// are not on Shellboy main, so production uses `noPending`, which is always empty. When #262
// lands, this file gains the real adapter; nothing else changes. Fixture data lives in tests.
import { signal, type ReadonlySignal } from "@preact/signals-core";
import type { Outcome } from "../../data/src";

export interface PendingItem {
  id: string;
  threadId: string;
  threadTitle: string;
  question: string;
  askedAt: string | undefined;
}

export interface PendingAdapter {
  readonly items: ReadonlySignal<PendingItem[]>;
  answer(id: string, text: string): Promise<Outcome<unknown>>;
}

export const noPending: PendingAdapter = {
  items: signal<PendingItem[]>([]),
  answer: async () => ({
    ok: false,
    error: { kind: "bridge", code: "not_available", message: "this Shellboy can't ask questions yet" },
  }),
};
