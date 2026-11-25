import type { PendingReply } from "../../data/src/protocol";
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

interface PlacementIndex {
  readonly saved: ReadonlySet<string | undefined>;
  readonly positions: ReadonlyMap<string | undefined, number>;
  readonly last: number;
  readonly afterByPosition: readonly number[];
}
const byProjection = new WeakMap<SavedItemProjection, WeakMap<readonly HistoryItem[], PlacementIndex>>();
function placementIndex(rows: readonly HistoryItem[], projection?: SavedItemProjection): PlacementIndex {
  const cached = projection && byProjection.get(projection)?.get(rows);
  if (cached) return cached;
  const saved = new Set(rows.flatMap(row => row.kind === "user" ? [row.provenance?.client_operation_id] : []));
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
  const afterByPosition = new Array<number>(rows.length).fill(-1);
  emitted.forEach((position, index) => { if (position !== undefined) afterByPosition[position] = index; });
  for (let i = 1; i < afterByPosition.length; i++) afterByPosition[i] = Math.max(afterByPosition[i - 1]!, afterByPosition[i]!);
  const result = { saved, positions, last, afterByPosition };
  if (projection) {
    let byRows = byProjection.get(projection);
    if (!byRows) { byRows = new WeakMap(); byProjection.set(projection, byRows); }
    byRows.set(rows, result);
  }
  return result;
}

export function ownSendPresentation(scope: string, cohort: readonly PendingOwnMessage[], rows: readonly HistoryItem[], live: readonly OwnSendTailRow[], projection?: SavedItemProjection): OwnSendLocalRegion {
  const { saved, positions, last, afterByPosition } = placementIndex(rows, projection);
  const retire = cohort.filter(row => row.plainMessageSend === true && saved.has(row.operationId));
  const retiring = new Set(retire.map(row => row.operationId));
  const localRows = cohort.filter(row => !retiring.has(row.operationId));
  const placed = live.flatMap(row => {
    if (row.kind !== "live") return [];
    const boundary = row.inputThroughNodeId;
    const position = boundary === null ? -1 : boundary === undefined ? undefined : positions.get(boundary);
    const afterSequenceIndex = position === undefined ? last : afterByPosition[position] ?? -1;
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


/** Typed wait presentation for the exact locally retained message, never hint prose. */
export function ownMessageHeldBy(messageId: string | undefined, rows: readonly PendingReply[]) {
  if (!messageId) return undefined;
  const held = rows.find(row => row.message_id === messageId)?.held_by;
  if (!held) return undefined;
  switch (held.kind) {
    case "foreground_shell": return { kind: held.kind, executionId: held.execution_id } as const;
    case "response_generation": case "run_completion": case "recovery_wait": return { kind: held.kind } as const;
    case "stopping": case "unknown": return undefined;
  }
}
