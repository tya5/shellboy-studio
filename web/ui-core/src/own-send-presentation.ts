import type { HistoryItem } from "../../data/src/protocol";
import type { SavedItemProjection } from "./conversation-items";
import type { PendingOwnMessage } from "./model";

export interface OwnSendPresentation<Ref> {
  readonly token: object;
  readonly ref: Ref | undefined;
  readonly scope: string;
  readonly cohortVersion?: Readonly<{ accepted: readonly PendingOwnMessage[]; pending: PendingOwnMessage | undefined }>;
  readonly projection: SavedItemProjection;
  readonly displayedSavedUserIds: ReadonlySet<string>;
  readonly localRows: readonly PendingOwnMessage[];
  readonly retire: readonly PendingOwnMessage[];
}

export interface OwnSendPresentationInput<Ref> {
  readonly ref: Ref | undefined;
  readonly current: boolean;
  readonly scope: string;
  readonly cohortVersion?: Readonly<{ accepted: readonly PendingOwnMessage[]; pending: PendingOwnMessage | undefined }>;
  readonly projection: SavedItemProjection;
  readonly localRows: readonly PendingOwnMessage[];
  readonly hiddenItemKeys: ReadonlySet<string>;
  readonly canonicalRows?: readonly HistoryItem[];
}

export function completeDisplayedOwnUserIds<Ref>(input: OwnSendPresentationInput<Ref>): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!input.current || !input.ref) return ids;
  const mounted = new Set((input.projection.sequence ?? []).flatMap(entry => entry.kind === "conversation" ? [entry.itemKey] : []));
  for (const item of input.projection.items) {
    const source = item.source;
    if (mounted.has(item.key) && !input.hiddenItemKeys.has(item.key)
      && item.classification?.classification === "conversation" && source.kind === "user"
      && source.textComplete === true && typeof source.text === "string"
      && source.text.trim() !== "" && source.nodeId) ids.add(source.nodeId);
  }
  return ids;
}

export interface OwnSendDecision<Ref> extends OwnSendPresentation<Ref> {
  readonly cohort: readonly PendingOwnMessage[];
}
export type OwnSendLocalRegion = Pick<OwnSendDecision<unknown>, "scope" | "cohort" | "localRows" | "retire">;
export function captureOwnSendLocalRegion(result: OwnSendDecision<unknown>): OwnSendLocalRegion {
  return Object.freeze({ scope: result.scope, cohort: result.cohort, localRows: result.localRows, retire: result.retire });
}
export function emptyOwnSendLocalRegion(scope: string): OwnSendLocalRegion {
  return Object.freeze({ scope, cohort: Object.freeze([]), localRows: Object.freeze([]), retire: Object.freeze([]) });
}

export function ownSendPresentation<Ref>(input: OwnSendPresentationInput<Ref>): OwnSendDecision<Ref> {
  const cohort = Object.freeze(input.localRows.filter(row => row.scope === input.scope));
  const displayed = completeDisplayedOwnUserIds(input);
  const matches = cohort.filter(row => {
    if (!input.current || !input.ref || row.phase !== "accepted" || !row.messageId
      || !displayed.has(row.messageId) || row.plainMessageSend !== true) return false;
    const candidates = (input.canonicalRows ?? []).filter(node => node.node_id === row.messageId);
    const node = candidates[0], part = node?.items?.[0];
    return candidates.length === 1 && node?.kind === "user" && node.items?.length === 1
      && part?.kind === "text" && part.text_complete === true && typeof part.text === "string"
      && part.text.trim().length > 0;
  });
  const matchingIds = new Set(matches.flatMap(row => row.messageId ? [row.messageId] : []));
  const visible = input.current ? input.projection.items.filter(item =>
    !cohort.some(row => row.messageId === item.source.nodeId && !matchingIds.has(row.messageId!))) : [];
  const projection = Object.freeze({
    ...input.projection,
    items: Object.freeze(visible),
    sequence: Object.freeze(input.current ? input.projection.sequence ?? [] : []),
  });
  const localRows = Object.freeze(cohort.filter(row => !matchingIds.has(row.messageId ?? "")));
  return Object.freeze({ token: Object.freeze({}), ref: input.ref, scope: input.scope,
    cohortVersion: input.cohortVersion, projection, displayedSavedUserIds: displayed, cohort,
    localRows, retire: Object.freeze(matches) });
}
