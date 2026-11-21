import type { HistoryItem } from "../../data/src/protocol";
import type { ProjectedSavedItem, SavedItemProjection } from "./conversation-items";
import type { PendingOwnMessage } from "./model";

export function ownSendRowKey(messageId: string): string { return `own:${messageId}`; }

export interface OwnSendPresentationInput<Ref> {
  readonly ref: Ref | undefined;
  readonly current: boolean;
  readonly scope: string;
  readonly projection: SavedItemProjection;
  readonly localRows: readonly PendingOwnMessage[];
  readonly canonicalRows?: readonly HistoryItem[];
  readonly liveOrdinals?: ReadonlyMap<string, number>;
  readonly reconciledOwnMessageIds?: ReadonlySet<string>;
}

export type OwnSendTailRow = Readonly<{ kind: "own"; ordinal: number; row: PendingOwnMessage }>
  | Readonly<{ kind: "live"; ordinal: number; item: ProjectedSavedItem }>;
export interface OwnSendDecision<Ref> {
  readonly scope: string;
  readonly projection: SavedItemProjection;
  readonly cohort: readonly PendingOwnMessage[];
  readonly localRows: readonly PendingOwnMessage[];
  readonly retire: readonly PendingOwnMessage[];
  readonly tailRows: readonly OwnSendTailRow[];
  readonly ownMessageIds: ReadonlySet<string>;
}
export type OwnSendLocalRegion = Pick<OwnSendDecision<unknown>, "scope" | "cohort" | "localRows" | "retire" | "tailRows" | "ownMessageIds">;

export function captureOwnSendLocalRegion(result: OwnSendDecision<unknown>): OwnSendLocalRegion {
  return Object.freeze({ scope: result.scope, cohort: result.cohort, localRows: result.localRows,
    retire: result.retire, tailRows: result.tailRows, ownMessageIds: result.ownMessageIds });
}
export function emptyOwnSendLocalRegion(scope: string): OwnSendLocalRegion {
  return Object.freeze({ scope, cohort: Object.freeze([]), localRows: Object.freeze([]), retire: Object.freeze([]),
    tailRows: Object.freeze([]), ownMessageIds: new Set<string>() });
}

export function ownSendPresentation<Ref>(input: OwnSendPresentationInput<Ref>): OwnSendDecision<Ref> {
  const cohort = Object.freeze(input.localRows.filter(row => row.scope === input.scope));
  const mounted = new Set((input.projection.sequence ?? []).flatMap(entry => entry.kind === "conversation" ? [entry.itemKey] : []));
  const matches = cohort.filter(row => {
    if (!input.current || !input.ref || row.phase !== "accepted" || !row.messageId || !row.plainMessageSend) return false;
    const item = input.projection.items.find(item => mounted.has(item.key) && item.classification?.classification === "conversation"
      && item.source.kind === "user" && item.source.nodeId === row.messageId && item.source.textComplete === true
      && typeof item.source.text === "string" && item.source.text.trim() !== "");
    if (!item) return false;
    const candidates = (input.canonicalRows ?? []).filter(node => node.node_id === row.messageId);
    const node = candidates[0], part = node?.items?.[0];
    return candidates.length === 1 && node?.kind === "user" && node.items?.length === 1
      && part?.kind === "text" && part.text_complete === true && typeof part.text === "string" && part.text.trim() !== "";
  });
  const matchingIds = new Set(matches.map(row => row.messageId!));
  const suppressedIds = new Set(cohort.flatMap(row => row.messageId && !matchingIds.has(row.messageId) ? [row.messageId] : []));
  const visible = input.current ? input.projection.items.filter(item => !item.source.nodeId || !suppressedIds.has(item.source.nodeId)) : [];
  const liveRows: OwnSendTailRow[] = input.current ? input.projection.items.flatMap(item => {
    const source = item.source;
    if (!("domain" in source && source.domain === "live" && source.namespace === "handoff" && source.attemptId)) return [];
    const ordinal = input.liveOrdinals?.get(String(source.attemptId));
    return ordinal === undefined ? [] : [{ kind: "live" as const, ordinal, item }];
  }) : [];
  const ownRows: OwnSendTailRow[] = input.current ? cohort.filter(row => !matchingIds.has(row.messageId ?? ""))
    .map(row => ({ kind: "own" as const, ordinal: row.clientOrdinal, row })) : [];
  const tailRows = Object.freeze([...liveRows, ...ownRows].sort((a, b) => a.ordinal - b.ordinal));
  const ownIds = new Set(cohort.flatMap(row => row.messageId ? [row.messageId] : []));
  for (const id of input.reconciledOwnMessageIds ?? []) ownIds.add(id);
  const savedUserIds = new Set(input.current ? input.projection.items.flatMap(item => item.source.kind === "user" && item.source.nodeId ? [item.source.nodeId] : []) : []);
  const ownMessageIds = Object.freeze(new Set([...ownIds].filter(id => savedUserIds.has(id))));
  const liveKeys = new Set(input.projection.items.flatMap(item => {
    const source = item.source;
    return "domain" in source && source.domain === "live" && source.namespace === "handoff" ? [item.key] : [];
  }));
  const projection = Object.freeze({ ...input.projection, items: Object.freeze(visible),
    sequence: Object.freeze(input.current ? (input.projection.sequence ?? []).filter(entry => entry.kind !== "conversation" || !liveKeys.has(entry.itemKey)) : []) });
  return Object.freeze({ scope: input.scope, projection, cohort, localRows: Object.freeze(cohort.filter(row => !matchingIds.has(row.messageId ?? ""))),
    retire: Object.freeze(matches), tailRows, ownMessageIds });
}
