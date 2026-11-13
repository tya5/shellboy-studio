import type { DisplayAssociation } from '../../data/src/handoff';
import type { HistoryItem } from '../../data/src/protocol';
import { projectHistoryWindowItems } from './conversation-items';

/** One current FINAL ordinary-answer bundle, never a node-wide reservation. */
export interface AssistantOwnership {
  readonly scope: string;
  readonly attemptId: string;
  readonly turnId: string;
  readonly recordKey: string;
  readonly mode: 'preview' | 'canonical';
  readonly itemKeys: readonly string[];
}

export function assistantOwnership(association: DisplayAssociation, recordKey: string,
  rows: readonly HistoryItem[], revision: string | number): AssistantOwnership | undefined {
  const nodeIds = new Set(association.refs.map(ref => ref.nodeId));
  const nodes = rows.filter(row => row.node_id && nodeIds.has(row.node_id));
  if (!nodeIds.size || nodeIds.size > 64 || nodes.length !== nodeIds.size
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
  const nonempty = ordinary.some(item => item.source.kind === 'text' && !!item.source.text);
  return Object.freeze({ scope: association.scope, attemptId: association.attemptId, turnId: association.turnId,
    recordKey, mode: complete && nonempty ? 'canonical' : 'preview', itemKeys: Object.freeze(ordinary.map(item => item.key)) });
}
