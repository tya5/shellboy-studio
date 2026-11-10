import type { HistoryItem, HistoryItemsUnavailableReason } from "../../data/src/protocol";
/** Internal normalized contract only. Not a Core wire type or a body adapter. */
export interface SavedItemIdentity {
  readonly nodeId: string;
  /** Authoritative node-local identity; never a window/array index. */
  readonly itemIdentity: string;
  /** Content authorization version, not automatically part of the DOM key. */
  readonly revision?: string;
  /** Existing window revision, never an invented item revision. */
  readonly windowRevision?: string | number;
}

export type NormalizedSavedItem = SavedItemIdentity & (
  | { readonly kind: "text"; readonly text: string; readonly textComplete?: boolean }
  | { readonly kind: "tool"; readonly executionId?: string; readonly executionIds?: readonly string[] }
  // Hidden reasoning deliberately has no text field.
  | { readonly kind: "reasoning" }
  | { readonly kind: "reasoning_unavailable" }
  | { readonly kind: "unavailable"; readonly reason?: HistoryItemsUnavailableReason }
  | { readonly kind: "unknown" }
);

export interface ProjectedSavedItem {
  /** Stable authoritative node/item identity; revision proof is separate. */
  readonly key: string;
  readonly source: NormalizedSavedItem;
}
export interface ToolSummaryMembership {
  /** Chrome identity only; changes cannot reparent members. */
  readonly anchorKey: string;
  readonly memberKeys: readonly string[];
  readonly executionIds: readonly string[];
}
export interface SavedItemProjection {
  readonly items: readonly ProjectedSavedItem[];
  readonly toolSummaries: readonly ToolSummaryMembership[];
  /** Cannot infer a text break or a tool join across these source items. */
  readonly partitionUnknownKeys: readonly string[];
}

/** Input is authoritative saved order, not live/publication state.
 * Unknown partitions close only the confirmed run, not an inferred body run.
 */
export function projectSavedItems(input: readonly NormalizedSavedItem[]): SavedItemProjection {
  const items: ProjectedSavedItem[] = [];
  const toolSummaries: ToolSummaryMembership[] = [];
  const partitionUnknownKeys: string[] = [];
  const seenItems = new Set<string>();
  const executions = new Set<string>();
  let members: string[] = [];
  let runExecutions: string[] = [];
  const flush = () => {
    if (members.length) toolSummaries.push(Object.freeze({
      anchorKey: members[0]!, memberKeys: Object.freeze(members),
      executionIds: Object.freeze(runExecutions),
    }));
    members = [];
    runExecutions = [];
  };
  for (const source of input) {
    if (!source.nodeId || !source.itemIdentity || (source.revision === undefined && source.windowRevision === undefined)) {
      throw new Error("Normalized saved item requires authoritative identity and revision");
    }
    // An unambiguous tuple, not a hash or an ordinal inferred from position.
    const key = JSON.stringify([source.nodeId, source.itemIdentity]);
    if (seenItems.has(key)) throw new Error("Duplicate normalized saved item identity");
    seenItems.add(key);
    // v3: explicitly contentless reasoning is transparent, never rendered.
    if (source.kind === "reasoning" || source.kind === "reasoning_unavailable") continue;
    let projectedExecutionIds: readonly string[] | undefined;
    if (source.kind === "tool") {
      if (source.executionId !== undefined && !source.executionId) throw new Error("Empty execution identity");
      const ids = source.executionIds ?? (source.executionId ? [source.executionId] : []);
      if (ids.some(id => !id)) throw new Error("Normalized tool requires execution identity");
      // One saved item can reference multiple executions; never split its key.
      const fresh = [...new Set(ids)].filter(id => !executions.has(id));
      if (ids.length && !fresh.length) continue;
      projectedExecutionIds = fresh;
      fresh.forEach(id => executions.add(id));
      members.push(key);
      runExecutions.push(...fresh);
    } else {
      flush();
      if (source.kind === "unknown" || source.kind === "unavailable") {
        partitionUnknownKeys.push(key);
      }
    }
    // Copy only known fields: no reasoning text or extra caller-owned payload.
    const identity = { nodeId: source.nodeId, itemIdentity: source.itemIdentity, ...(source.revision !== undefined ? { revision: source.revision } : {}), ...(source.windowRevision !== undefined ? { windowRevision: source.windowRevision } : {}) };
    const copy: NormalizedSavedItem = source.kind === "text" ? { ...identity, kind: "text", text: source.text, ...(source.textComplete !== undefined ? { textComplete: source.textComplete } : {}) }
      : source.kind === "tool" ? { ...identity, kind: "tool", ...(source.executionId !== undefined ? { executionId: source.executionId } : {}), ...(source.executionIds ? { executionIds: Object.freeze([...(projectedExecutionIds ?? source.executionIds)]) } : {}) }
      : { ...identity, kind: source.kind, ...(source.kind === "unavailable" && source.reason ? { reason: source.reason } : {}) };
    items.push(Object.freeze({ key, source: Object.freeze(copy) }));
  }
  flush();
  return Object.freeze({ items: Object.freeze(items), toolSummaries: Object.freeze(toolSummaries), partitionUnknownKeys: Object.freeze(partitionUnknownKeys) });
}


export interface ProjectedHistoryNode {
  readonly nodeId: string;
  readonly ordinal?: number;
  /** Ordinary retained node, not a fabricated content item. */
  readonly node: Readonly<HistoryItem>;
  readonly state: "items" | "legacy" | "deferred";
  readonly reason?: HistoryItemsUnavailableReason;
}
export interface HistoryWindowItemProjection {
  readonly projection: SavedItemProjection;
  readonly nodes: readonly ProjectedHistoryNode[];
  readonly retryFrom?: { readonly ordinal: number; readonly expect_node_id: string };
}

/** Accept ONLY the strict-decoded v3 DTO; does not decode unknown JSON. */
export function projectHistoryWindowItems(input: { readonly revision: string | number; readonly nodes: readonly HistoryItem[] }): HistoryWindowItemProjection {
  const nodes: ProjectedHistoryNode[] = [];
  const items: ProjectedSavedItem[] = [];
  const summaries: ToolSummaryMembership[] = [];
  const unknown: string[] = [];
  let segment: NormalizedSavedItem[] = [];
  let retryFrom: HistoryWindowItemProjection["retryFrom"];
  const flush = () => {
    const p = projectSavedItems(segment);
    items.push(...p.items); summaries.push(...p.toolSummaries); unknown.push(...p.partitionUnknownKeys);
    segment = [];
  };
  for (const node of input.nodes) {
    if (!node.node_id) throw new Error("Typed history node requires canonical node_id");
    const ordinal = node.selection?.ordinal;
    const state = node.items === undefined ? "legacy" : node.items === null ? "deferred" : "items";
    nodes.push(Object.freeze({ nodeId: node.node_id, ...(ordinal !== undefined ? { ordinal } : {}), node, state, ...(node.items_unavailable_reason ? { reason: node.items_unavailable_reason } : {}) }));
    if (!node.items) {
      // A whole-node gap is a partition boundary, not an invented item identity.
      flush();
      if (!retryFrom && node.items_unavailable_reason === "response_budget" && ordinal !== undefined) retryFrom = Object.freeze({ ordinal, expect_node_id: node.node_id });
      continue;
    }
    for (const item of node.items) {
      const identity = { nodeId: node.node_id, itemIdentity: item.item_identity, windowRevision: input.revision };
      switch (item.kind) {
        case "text": segment.push({ ...identity, kind: "text", text: item.text, textComplete: item.text_complete }); break;
        case "tool_call": case "tool_result": segment.push({ ...identity, kind: "tool", executionIds: item.execution_ids }); break;
        case "reasoning_unavailable": segment.push({ ...identity, kind: "reasoning_unavailable" }); break;
        case "unavailable": segment.push({ ...identity, kind: "unavailable", reason: item.reason }); break;
      }
    }
  }
  flush();
  const projection = Object.freeze({ items: Object.freeze(items), toolSummaries: Object.freeze(summaries), partitionUnknownKeys: Object.freeze(unknown) });
  return Object.freeze({ projection, nodes: Object.freeze(nodes), ...(retryFrom ? { retryFrom } : {}) });
}
