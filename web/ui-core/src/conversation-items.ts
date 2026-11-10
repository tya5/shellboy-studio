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

/** Input is authoritative saved order, not live/publication state. */
export function projectSavedItems(_items: readonly NormalizedSavedItem[]): SavedItemProjection {
  throw new Error("Phase-one scaffold: public #296 adapter/contract not approved");
}
