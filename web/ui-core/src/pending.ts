// Presentation-neutral inbox contract; the production adapter lives in the data layer.
export type { PendingItem, PendingAdapter } from "../../data/src/pending";
import { signal } from "@preact/signals-core";
import type { PendingAdapter } from "../../data/src/pending";
export const noPending: PendingAdapter = {
  items: signal([]),
  answer: async () => ({ ok: false, error: { kind: "bridge", code: "not_available", message: "human inbox unavailable" } }),
};
