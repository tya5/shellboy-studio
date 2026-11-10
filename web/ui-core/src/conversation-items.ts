import type { HistoryItem, HistoryItemsUnavailableReason, WorkItem } from "../../data/src/protocol";
/** Internal normalized contract only. Not a Core wire type or a body adapter. */
export interface SavedItemIdentity {
  readonly keyScope?: readonly string[];
  readonly nodeId: string;
  readonly identityDomain?: "node" | "spill";
  /** Authoritative node-local identity; never a window/array index. */
  readonly itemIdentity: string;
  /** Content authorization version, not automatically part of the DOM key. */
  readonly revision?: string;
  /** Existing window revision, never an invented item revision. */
  readonly windowRevision?: string | number;
}

export interface LiveWorkIdentity {
  readonly domain: "live";
  readonly namespace?: "work" | "handoff";
  readonly keyScope?: readonly string[];
  readonly scope: string;
  readonly recordId: string;
  readonly attemptId?: string;
  readonly turnId?: string;
  readonly nodeId?: never;
  readonly itemIdentity?: never;
  readonly revision?: never;
  readonly windowRevision?: never;
  readonly identityDomain?: never;
}
export type NormalizedSavedItem = (SavedItemIdentity | LiveWorkIdentity) & (
  | { readonly kind: "text"; readonly text: string; readonly textComplete?: boolean }
  | { readonly kind: "tool"; readonly executionId?: string; readonly executionIds?: readonly string[]; readonly callId?: string; readonly compressed?: boolean; readonly detailUnavailable?: boolean }
  // Hidden reasoning deliberately has no text field.
  | { readonly kind: "reasoning" }
  | { readonly kind: "reasoning_unavailable" }
  | { readonly kind: "unavailable"; readonly reason?: HistoryItemsUnavailableReason }
  | { readonly kind: "unknown" }
  | { readonly kind: "user" | "summary"; readonly text: string }
  | { readonly kind: "ordinaryEmpty" }
  | { readonly kind: "record" | "interruption" }
);

export interface ProjectedSavedItem {
  /** Stable authoritative node/item identity; revision proof is separate. */
  readonly key: string;
  readonly source: NormalizedSavedItem;
  readonly canonicalKey?: string;
  readonly toolIdentity?: "execution" | "call" | "unresolved";
}
export interface ToolSummaryMembership {
  /** Chrome identity only; changes cannot reparent members. */
  readonly anchorKey: string;
  readonly memberKeys: readonly string[];
  readonly executionIds: readonly string[];
  readonly continuationBefore?: "unknown" | "closed";
  readonly continuationAfter?: "unknown" | "closed";
}
export interface SavedItemProjection {
  readonly items: readonly ProjectedSavedItem[];
  readonly toolSummaries: readonly ToolSummaryMembership[];
  /** Unknown content facts remain Work members; this list is not a run boundary. */
  readonly workGroups?: readonly WorkGroup[];
  readonly sequence?: readonly ConversationSequence[];
  readonly partitionUnknownKeys: readonly string[];
}

export interface WorkGroup extends ToolSummaryMembership {
  readonly key: string;
  readonly firstMemberKey: string;
  readonly toolItemKeys: readonly string[];
  readonly unknownToolCount: number;
  readonly interrupted: boolean;
}
export type ConversationSequence = { readonly kind: "conversation"; readonly itemKey: string } | { readonly kind: "work"; readonly groupKey: string };
export function classifyConversationItem(item: NormalizedSavedItem): "conversation" | "work" {
  return item.kind === "text" || item.kind === "user" || item.kind === "summary" || item.kind === "ordinaryEmpty" ? "conversation" : "work";
}
/** Authoritative ordered facts only. Live callers may append explicitly scoped tail facts. */
export function projectSavedItems(input: readonly NormalizedSavedItem[]): SavedItemProjection & { readonly workGroups: readonly WorkGroup[]; readonly sequence: readonly ConversationSequence[] } {
  const items: ProjectedSavedItem[] = [];
  const groups: WorkGroup[] = [];
  const sequence: ConversationSequence[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  const associationById = new Map<string, string>();
  const conflicts = new Set<string>();
  const association = (item: NormalizedSavedItem) => {
    if (item.kind !== "tool") return undefined;
    const scope = item.keyScope;
    if (!scope?.length || scope.some(value => !value)) return undefined;
    const ids = [...new Set(item.executionIds ?? (item.executionId ? [item.executionId] : []))].sort();
    if (ids.length) return { key: JSON.stringify(["tool", scope, "execution", ids]), ids, scope, type: "execution" as const };
    if (item.callId) return { key: JSON.stringify(["tool", scope, "call", item.callId]), ids: [], scope, type: "call" as const };
    return undefined;
  };
  for (const source of input) {
    const a = association(source);
    if (!a) continue;
    for (const id of [...(a.ids.length ? a.ids : [a.key]), ...(source.kind === "tool" && source.callId ? [JSON.stringify(["call", source.callId])] : [])]) {
      const scoped = JSON.stringify([a.scope, id]);
      const prior = associationById.get(scoped);
      if (prior && prior !== a.key) { conflicts.add(prior); conflicts.add(a.key); }
      associationById.set(scoped, a.key);
    }
  }
  const selectedTools = new Map<string, number>();
  let members: string[] = [], toolKeys: string[] = [], ids: string[] = [];
  let unknownTools = 0, interrupted = false;
  let before: "unknown" | "closed" = "unknown";
  const flush = (after: "unknown" | "closed") => {
    if (members.length) {
      const key = JSON.stringify(["work", toolKeys[0] ?? members[0]]);
      groups.push(Object.freeze({ key, firstMemberKey: members[0]!, anchorKey: members[0]!, memberKeys: Object.freeze(members), executionIds: Object.freeze(ids), toolItemKeys: Object.freeze(toolKeys), unknownToolCount: unknownTools, interrupted, continuationBefore: before, continuationAfter: after }));
      sequence.push(Object.freeze({ kind: "work", groupKey: key }));
    }
    members = []; toolKeys = []; ids = []; unknownTools = 0; interrupted = false;
  };
  for (const source of input) {
    if (!("domain" in source) && (!source.nodeId || !source.itemIdentity || (source.revision === undefined && source.windowRevision === undefined && !(source.identityDomain === "node" && source.kind === "unknown" && source.itemIdentity === source.nodeId)))) throw new Error("Missing authoritative identity/proof");
    if ("domain" in source && (!source.scope || !source.recordId)) throw new Error("Missing live record identity");
    const canonicalKey = "domain" in source ? JSON.stringify(["live", source.namespace ?? "work", source.scope, source.recordId]) : source.identityDomain === "spill" ? JSON.stringify(["spill", source.nodeId, source.itemIdentity]) : source.identityDomain === "node" ? JSON.stringify(["node", source.nodeId]) : JSON.stringify([source.nodeId, source.itemIdentity]);
    const a = association(source);
    const proven = a && !conflicts.has(a.key) ? a : undefined;
    const key = source.kind === "tool" && proven ? proven.key : canonicalKey;
    if (seen.has(canonicalKey)) throw new Error("Duplicate normalized saved item identity");
    seen.add(canonicalKey);
    if (proven && selectedTools.has(key)) {
      const index = selectedTools.get(key)!;
      const previous = items[index]!;
      if (previous.source.kind === "tool" && source.kind === "tool" && source.compressed) {
        items[index] = Object.freeze({ ...previous, source: Object.freeze({ ...previous.source, compressed: true }) });
      }
      continue;
    }
    if (proven) selectedTools.set(key, items.length);
    const identity = "domain" in source ? { domain: "live" as const, namespace: source.namespace ?? "work", scope: source.scope, recordId: source.recordId, ...(source.attemptId !== undefined ? { attemptId: source.attemptId } : {}), ...(source.turnId !== undefined ? { turnId: source.turnId } : {}) } : { ...(source.identityDomain ? { identityDomain: source.identityDomain } : {}), nodeId: source.nodeId, itemIdentity: source.itemIdentity, ...(source.revision !== undefined ? { revision: source.revision } : {}), ...(source.windowRevision !== undefined ? { windowRevision: source.windowRevision } : {}) };
    const scopedIdentity = { ...identity, ...(source.keyScope ? { keyScope: Object.freeze([...source.keyScope]) } : {}) };
    let copy: NormalizedSavedItem;
    if (source.kind === "tool") {
      if (source.executionId !== undefined && !source.executionId) throw new Error("Empty execution identity");
      const raw = source.executionIds ?? (source.executionId ? [source.executionId] : []);
      if (raw.some(id => !id)) throw new Error("Empty execution identity");
      const fresh = [...new Set(raw)];
      ids.push(...fresh); toolKeys.push(key);
      if (!proven) unknownTools++;
      copy = { ...scopedIdentity, kind: "tool", executionIds: Object.freeze(a ? [...new Set(raw)] : fresh), ...(source.callId ? { callId: source.callId } : {}), ...(source.compressed ? { compressed: true } : {}), ...(source.detailUnavailable ? { detailUnavailable: true } : {}), ...(source.executionId ? { executionId: source.executionId } : {}) };
    } else if (source.kind === "text") copy = { ...scopedIdentity, kind: "text", text: source.text, ...(source.textComplete !== undefined ? { textComplete: source.textComplete } : {}) };
    else if (source.kind === "user" || source.kind === "summary") copy = { ...scopedIdentity, kind: source.kind, text: source.text };
    else copy = { ...scopedIdentity, kind: source.kind, ...(source.kind === "unavailable" && source.reason ? { reason: source.reason } : {}) } as NormalizedSavedItem;
    if (classifyConversationItem(source) === "conversation") {
      flush("closed"); before = "closed";
      sequence.push(Object.freeze({ kind: "conversation", itemKey: key }));
    } else {
      members.push(key);
      interrupted ||= source.kind === "interruption";
      if (source.kind === "unknown" || source.kind === "unavailable") unknown.push(key);
    }
    items.push(Object.freeze({ key, canonicalKey, ...(source.kind === "tool" ? { toolIdentity: proven?.type ?? "unresolved" } : {}), source: Object.freeze(copy) }));
  }
  flush("unknown");
  return Object.freeze({ items: Object.freeze(items), toolSummaries: Object.freeze(groups), workGroups: Object.freeze(groups), sequence: Object.freeze(sequence), partitionUnknownKeys: Object.freeze(unknown) });
}

export interface ProjectedHistoryNode {
  readonly nodeId: string;
  readonly ordinal?: number;
  /** Ordinary retained node, not a fabricated content item. */
  readonly node: Readonly<HistoryItem>;
  readonly state: "items" | "legacy" | "deferred";
  readonly emptyOrdinary: boolean;
  readonly reason?: HistoryItemsUnavailableReason;
}
export interface HistoryWindowItemProjection {
  readonly projection: SavedItemProjection;
  readonly nodes: readonly ProjectedHistoryNode[];
  readonly retryFrom?: { readonly ordinal: number; readonly expect_node_id: string };
}

/** Accept ONLY the strict-decoded v3 DTO; does not decode unknown JSON. */
export function projectHistoryWindowItems(input: { readonly keyScope?: readonly string[]; readonly revision: string | number; readonly nodes: readonly HistoryItem[] }): HistoryWindowItemProjection {
  const nodes: ProjectedHistoryNode[] = [];
  const segment: NormalizedSavedItem[] = [];
  let retryFrom: HistoryWindowItemProjection["retryFrom"];
  for (const node of input.nodes) {
    if (!node.node_id) throw new Error("Typed history node requires canonical node_id");
    const ordinal = node.selection?.ordinal;
    const state = node.items === undefined ? "legacy" : node.items === null ? "deferred" : "items";
    nodes.push(Object.freeze({ nodeId: node.node_id, ...(ordinal !== undefined ? { ordinal } : {}), node, state, emptyOrdinary: state === "items" && ["user", "assistant_response", "tool_result"].includes(node.kind ?? "") && node.items!.every(item => item.kind === "reasoning_unavailable"), ...(node.items_unavailable_reason ? { reason: node.items_unavailable_reason } : {}) }));
    if (node.kind === "spill" && node.spill_tools) {
      // Public spill-local IDs only. No payload/args hydration or original-node join.
      const metadata = node.spill_tools;
      const seenSources = new Set<string>();
      for (const tool of metadata.items) {
        const sourceKey = JSON.stringify([tool.call_id, tool.execution_id ?? null]);
        if (seenSources.has(sourceKey)) continue;
        seenSources.add(sourceKey);
        segment.push({ nodeId: node.node_id, itemIdentity: sourceKey, identityDomain: "spill", windowRevision: input.revision, ...(input.keyScope ? { keyScope: input.keyScope } : {}), kind: "tool", callId: tool.call_id, executionIds: tool.execution_id ? [tool.execution_id] : [], compressed: true, detailUnavailable: true });
      }
      if (metadata.status !== "known" || metadata.truncated || !metadata.items.length) {
        segment.push({ nodeId: node.node_id, itemIdentity: node.node_id, identityDomain: "node", windowRevision: input.revision, kind: "unavailable" });
      }
      continue;
    }
    if (!node.items) {
      // Canonical node-level record, never a fabricated wire item identity.
      const base = { nodeId: node.node_id, itemIdentity: node.node_id, identityDomain: "node" as const, windowRevision: input.revision };
      const safeHuman = node.items === undefined && node.kind === "user";
      segment.push(safeHuman ? { ...base, kind: "user", text: node.excerpt ?? "" } : node.items_unavailable_reason ? { ...base, kind: "unavailable", reason: node.items_unavailable_reason } : { ...base, kind: "unknown" });
      if (!retryFrom && node.items_unavailable_reason === "response_budget" && ordinal !== undefined) retryFrom = Object.freeze({ ordinal, expect_node_id: node.node_id });
      continue;
    }
    if (!node.items.length) {
      const base = { nodeId: node.node_id, itemIdentity: node.node_id, identityDomain: "node" as const, windowRevision: input.revision };
      segment.push({ ...base, kind: ["user", "assistant_response", "tool_result"].includes(node.kind ?? "") ? "ordinaryEmpty" : "record" });
    }
    for (const item of node.items) {
      const identity = { ...(input.keyScope ? { keyScope: input.keyScope } : {}), nodeId: node.node_id, itemIdentity: item.item_identity, windowRevision: input.revision };
      switch (item.kind) {
        case "text":
          // Structural node kind outranks the provider's text-item role.
          if (node.kind === "user" || node.kind === "assistant_response" || node.kind === "summary") {
            segment.push({ ...identity, kind: "text", text: item.text, textComplete: item.text_complete });
          } else segment.push({ ...identity, kind: "record" });
          break;
        case "tool_call": case "tool_result": segment.push({ ...identity, kind: "tool", executionIds: item.execution_ids }); break;
        case "reasoning_unavailable": segment.push({ ...identity, kind: "reasoning_unavailable" }); break;
        case "unavailable": segment.push({ ...identity, kind: "unavailable", reason: item.reason }); break;
      }
    }
  }
  const projection = projectSavedItems(segment);
  return Object.freeze({ projection, nodes: Object.freeze(nodes), ...(retryFrom ? { retryFrom } : {}) });
}


/** Explicit live namespace: no saved node/item/ordinal or excerpt inference. */
export function normalizeLiveWorkFacts(input: { readonly scope: string; readonly items: readonly WorkItem[] }): readonly NormalizedSavedItem[] {
  return Object.freeze(input.items.filter(item => item.kind !== "pending_message" && !(item.kind === "message" && ["accepted", "held"].includes(item.state))).map(item => {
    if (!input.scope || !item.id || item.thread_id !== input.scope) throw new Error("Invalid live work scope");
    const identity = { domain: "live" as const, scope: input.scope, recordId: item.id, ...(typeof item.attempt_id === "string" ? { attemptId: item.attempt_id } : {}), ...(typeof item.turn_id === "string" ? { turnId: item.turn_id } : {}) };
    return Object.freeze(item.kind === "shell" && item.execution_id ? { ...identity, kind: "tool" as const, executionIds: Object.freeze([item.execution_id]) } : { ...identity, kind: "record" as const });
  }));
}
