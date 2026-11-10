/** Internal normalized contract only. Not a Core wire type or a body adapter. */
export interface SavedItemIdentity {
  readonly nodeId: string;
  /** Authoritative node-local identity; never a window/array index. */
  readonly itemIdentity: string;
  /** Content authorization version, not automatically part of the DOM key. */
  readonly revision: string;
}

export type NormalizedSavedItem = SavedItemIdentity & (
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly executionId: string }
  // Hidden reasoning deliberately has no text field.
  | { readonly kind: "reasoning" }
  | { readonly kind: "unavailable" }
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
    if (!source.nodeId || !source.itemIdentity || !source.revision) {
      throw new Error("Normalized saved item requires authoritative identity and revision");
    }
    // An unambiguous tuple, not a hash or an ordinal inferred from position.
    const key = JSON.stringify([source.nodeId, source.itemIdentity]);
    if (seenItems.has(key)) throw new Error("Duplicate normalized saved item identity");
    seenItems.add(key);
    if (source.kind === "tool") {
      if (!source.executionId) throw new Error("Normalized tool requires execution identity");
      // Request/result associations refer to one actual execution.
      if (executions.has(source.executionId)) continue;
      executions.add(source.executionId);
      members.push(key);
      runExecutions.push(source.executionId);
    } else {
      flush();
      if (source.kind === "reasoning" || source.kind === "unavailable") {
        partitionUnknownKeys.push(key);
      }
    }
    // Copy only known fields: no reasoning text or extra caller-owned payload.
    const identity = { nodeId: source.nodeId, itemIdentity: source.itemIdentity, revision: source.revision };
    const copy: NormalizedSavedItem = source.kind === "text" ? { ...identity, kind: "text", text: source.text }
      : source.kind === "tool" ? { ...identity, kind: "tool", executionId: source.executionId }
      : { ...identity, kind: source.kind };
    items.push(Object.freeze({ key, source: Object.freeze(copy) }));
  }
  flush();
  return Object.freeze({ items: Object.freeze(items), toolSummaries: Object.freeze(toolSummaries), partitionUnknownKeys: Object.freeze(partitionUnknownKeys) });
}
