import type { HistoryItem } from "../../data/src/protocol";
import type { ProjectedSavedItem } from "./conversation-items";
import type { PendingOwnMessage } from "./model";

export type OwnSendTailRow = Readonly<{ kind: "own"; ordinal: number; row: PendingOwnMessage }>
  | Readonly<{ kind: "live"; ordinal: number; item: ProjectedSavedItem }>;
export interface OwnSendLocalRegion {
  readonly scope: string;
  readonly cohort: readonly PendingOwnMessage[];
  readonly localRows: readonly PendingOwnMessage[];
  readonly retire: readonly PendingOwnMessage[];
  readonly tailRows: readonly OwnSendTailRow[];
  readonly ownMessageIds: ReadonlySet<string>;
}

export function ownSendPresentation(scope: string, cohort: readonly PendingOwnMessage[], rows: readonly HistoryItem[], live: readonly OwnSendTailRow[]): OwnSendLocalRegion {
  const saved = new Set(rows.flatMap(row => row.kind === "user" ? [row.node_id] : []));
  const retire = cohort.filter(row => row.messageId !== undefined && saved.has(row.messageId));
  const ownMessageIds = new Set(retire.map(row => row.messageId!));
  const localRows = cohort.filter(row => !ownMessageIds.has(row.messageId ?? ""));
  const tailRows = [...live, ...localRows.map(row => ({ kind: "own" as const, ordinal: row.clientOrdinal, row }))];
  return Object.freeze({ scope, cohort: Object.freeze(cohort), localRows: Object.freeze(localRows),
    retire: Object.freeze(retire), tailRows: Object.freeze(tailRows.sort((a, b) => a.ordinal - b.ordinal)), ownMessageIds });
}
