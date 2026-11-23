import type { HistoryItem } from "../../data/src/protocol";
import type { ProjectedSavedItem, SavedItemProjection } from "./conversation-items";
import type { PendingOwnMessage } from "./model";

export type OwnSendTailRow = Readonly<{ kind: "own"; row: PendingOwnMessage }>
  | Readonly<{ kind: "live"; inputThroughNodeId?: string | null; item: ProjectedSavedItem; outputLimit?: import("../../data/src/protocol").AttemptOutputLimit }>;
export type PositionedOwnSendRow = OwnSendTailRow & { readonly afterSequenceIndex: number };
export interface OwnSendLocalRegion {
  readonly scope: string;
  readonly cohort: readonly PendingOwnMessage[];
  readonly localRows: readonly PendingOwnMessage[];
  readonly retire: readonly PendingOwnMessage[];
  readonly tailRows: readonly PositionedOwnSendRow[];
}

export function ownSendPresentation(scope: string, cohort: readonly PendingOwnMessage[], rows: readonly HistoryItem[], live: readonly OwnSendTailRow[], projection?: SavedItemProjection): OwnSendLocalRegion {
  const saved = new Set(rows.flatMap(row => row.kind === "user" ? [row.provenance?.client_operation_id] : []));
  const retire = cohort.filter(row => row.plainMessageSend === true && saved.has(row.operationId));
  const retiring = new Set(retire.map(row => row.operationId));
  const localRows = cohort.filter(row => !retiring.has(row.operationId));
  // Only saved path membership qualifies an input boundary; ordinals are not path positions.
  const positions = new Map(rows.map((row, i) => [row.node_id, i]));
  const items = new Map(projection?.items.map(item => [item.key, item]));
  const groups = new Map(projection?.workGroups?.map(group => [group.key, group.memberKeys]));
  const last = (projection?.sequence?.length ?? 0) - 1;
  const emitted = (projection?.sequence ?? []).map(entry => {
    const keys = entry.kind === "conversation" ? [entry.itemKey] : groups.get(entry.groupKey) ?? [];
    const nodes = keys.flatMap(key => {
      const source = items.get(key)?.source;
      if (!source || (source.kind === "text" && source.text === "" && source.textComplete === true)) return [];
      const position = positions.get(source.nodeId);
      return position === undefined ? [] : [position];
    });
    return nodes.length ? Math.max(...nodes) : undefined;
  });
  const placed = live.flatMap(row => {
    if (row.kind !== "live") return [];
    const boundary = row.inputThroughNodeId;
    const position = boundary === null ? -1 : boundary === undefined ? undefined : positions.get(boundary);
    const afterSequenceIndex = position === undefined ? last : emitted.reduce<number>((anchor, node, i) => node !== undefined && node <= position ? i : anchor, -1);
    const afterOwn = position !== undefined || boundary == null ? -1 : localRows.findIndex(own => own.messageId === boundary);
    return [{ row: { ...row, afterSequenceIndex }, afterOwn }];
  });
  const tailRows: PositionedOwnSendRow[] = placed.filter(entry => entry.afterOwn === -1).map(entry => entry.row);
  localRows.forEach((row, index) => {
    tailRows.push({ kind: "own", row, afterSequenceIndex: last });
    tailRows.push(...placed.filter(entry => entry.afterOwn === index).map(entry => entry.row));
  });
  return Object.freeze({ scope, cohort: Object.freeze(cohort), localRows: Object.freeze(localRows),
    retire: Object.freeze(retire), tailRows: Object.freeze(tailRows) });
}
