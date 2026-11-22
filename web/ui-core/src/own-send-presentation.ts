import type { HistoryItem } from "../../data/src/protocol";
import type { ProjectedSavedItem } from "./conversation-items";
import type { PendingOwnMessage } from "./model";

export type OwnSendTailRow = Readonly<{ kind: "own"; ordinal: number; row: PendingOwnMessage }>
  | Readonly<{ kind: "live"; ordinal: number; inputThroughNodeId?: string | null; beforeSavedNodeId?: string; item: ProjectedSavedItem }>;
export interface OwnSendLocalRegion {
  readonly scope: string;
  readonly cohort: readonly PendingOwnMessage[];
  readonly localRows: readonly PendingOwnMessage[];
  readonly retire: readonly PendingOwnMessage[];
  readonly tailRows: readonly OwnSendTailRow[];
}

export function ownSendPresentation(scope: string, cohort: readonly PendingOwnMessage[], rows: readonly HistoryItem[], live: readonly OwnSendTailRow[]): OwnSendLocalRegion {
  const saved = new Set(rows.flatMap(row => row.kind === "user" ? [row.provenance?.client_operation_id] : []));
  const retire = cohort.filter(row => row.plainMessageSend === true && saved.has(row.operationId));
  const retiring = new Set(retire.map(row => row.operationId));
  const localRows = cohort.filter(row => !retiring.has(row.operationId));
  // Only saved path membership qualifies an input boundary; ordinals are not path positions.
  const positions = new Map(rows.map((row, i) => [row.node_id, i]));
  const savedUsers = rows.filter(row => row.kind === "user");
  const placed = live.flatMap(row => {
    if (row.kind !== "live") return [];
    const position = row.inputThroughNodeId === null ? -1
      : row.inputThroughNodeId === undefined ? undefined : positions.get(row.inputThroughNodeId);
    const before = position === undefined ? rows.find(saved => saved.kind === "user" && retire.some(own => own.operationId === saved.provenance?.client_operation_id))?.node_id
      : savedUsers.find(saved => positions.get(saved.node_id)! > position)?.node_id;
    return [before === undefined ? row : { ...row, beforeSavedNodeId: before }];
  });
  const afterOwn = new Map(placed.map(row => [row, row.inputThroughNodeId == null ? -1
    : localRows.findIndex(own => own.messageId === row.inputThroughNodeId)]));
  const tailRows: OwnSendTailRow[] = placed.filter(row => afterOwn.get(row) === -1);
  localRows.forEach((row, index) => {
    tailRows.push({ kind: "own", ordinal: row.clientOrdinal, row });
    tailRows.push(...placed.filter(liveRow => afterOwn.get(liveRow) === index));
  });
  return Object.freeze({ scope, cohort: Object.freeze(cohort), localRows: Object.freeze(localRows),
    retire: Object.freeze(retire), tailRows: Object.freeze(tailRows) });
}
