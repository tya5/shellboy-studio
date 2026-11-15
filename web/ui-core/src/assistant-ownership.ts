import {responseRefsMatchSelected} from "../../data/src/public-response-refs";
import type { DisplayAssociation } from '../../data/src/handoff';
import type { HistoryItem } from '../../data/src/protocol';
import type { PresentationContainerId } from '../../data/src/handoff';
import { projectHistoryWindowItems } from './conversation-items';

/** One current FINAL ordinary-answer bundle, never a node-wide reservation. */
export interface AssistantOwnership {
  readonly scope: string;
  readonly attemptId: string;
  readonly turnId: string;
  readonly recordKey: string;
  /** Stable answer container identity for the accepted presentation lifetime. */
  readonly containerKey: PresentationContainerId;
  readonly mode: 'preview' | 'canonical';
  readonly proofRevision: number;
  /** Immutable revision that minted the ready receipt; survives later read qualification. */
  readonly receiptRevision: number;
  readonly itemKeys: readonly string[];
  /** Canonical node/ordinal evidence retained for a fresh revision requalification. */
  readonly refs: readonly { readonly nodeId: string; readonly ordinal: number; readonly kind: string }[];
}

/** Full immutable identity used for both requalification and postcommit continuity. */
export function assistantOwnershipEqual(a: AssistantOwnership, b: AssistantOwnership): boolean {
  return a.scope === b.scope && a.attemptId === b.attemptId && a.turnId === b.turnId
    && a.recordKey === b.recordKey && a.containerKey === b.containerKey && a.mode === b.mode
    && a.proofRevision === b.proofRevision && a.receiptRevision === b.receiptRevision
    && a.itemKeys.length === b.itemKeys.length && a.itemKeys.every((key,index) => key === b.itemKeys[index])
    && a.refs.length === b.refs.length && a.refs.every((ref,index) => ref.nodeId === b.refs[index]?.nodeId
      && ref.ordinal === b.refs[index]?.ordinal && ref.kind === b.refs[index]?.kind);
}

export function assistantOwnership(association: DisplayAssociation, recordKey: string,
  rows: readonly HistoryItem[], revision: number): AssistantOwnership | undefined {
  const nodeIds = new Set(association.refs.map(ref => ref.nodeId));
  const nodes = rows.filter(row => row.node_id && nodeIds.has(row.node_id));
  if (!responseRefsMatchSelected(association.refs,nodes) || !nodeIds.size || nodeIds.size > 64 || nodes.length !== nodeIds.size
    || new Set(nodes.map(node => node.node_id)).size !== nodes.length
    || nodes.some(node => node.kind !== 'assistant_response' || !Array.isArray(node.items)
      || !node.items.length || node.items.some(item => item.kind === 'unavailable' || typeof item.item_identity !== 'string' || !item.item_identity)
      || new Set(node.items.map(item => item.item_identity)).size !== node.items.length
      || !Number.isSafeInteger(node.selection?.ordinal))) return;
  const projection = projectHistoryWindowItems({ nodes, revision, keyScope: [association.scope] }).projection;
  const keys = projection.items.map(item => item.key);
  if (new Set(keys).size !== keys.length) return;
  const ordinary = projection.items.filter(item => item.classification?.id === 'assistantText' && item.source.kind === 'text');
  if (!ordinary.length) return;
  // Final membership is known before reserving any item; unknown siblings confer no authority.
  if (projection.items.some(item => item.classification?.id === 'unknown' || item.source.kind === 'unavailable')) return;
  const complete = ordinary.every(item => item.source.kind === 'text' && item.source.textComplete === true);
  const nonempty = ordinary.every(item => item.source.kind === 'text' && !!item.source.text);
  const canonical = complete && nonempty;
  // Preview owns only unavailable members, never a separately complete saved sibling.
  const members = canonical ? ordinary : ordinary.filter(item => item.source.kind === 'text'
    && (!item.source.textComplete || !item.source.text));
  return Object.freeze({ scope: association.scope, attemptId: association.attemptId, turnId: association.turnId,
    recordKey, containerKey: association.presentationContainer, proofRevision: revision, receiptRevision: revision, mode: canonical ? 'canonical' : 'preview',
    itemKeys: Object.freeze(members.map(item => item.key)), refs: Object.freeze(association.refs.map(ref => Object.freeze({ ...ref }))) });
}
