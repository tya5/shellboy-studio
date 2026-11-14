import { emptyOwnSendLocalRegion } from "./own-send-presentation";
import type { HandoffRecord } from '../../data/src/handoff';
import type { WindowAcceptedSnapshot } from './window';
import type { OwnUserDecision, ConversationDisplayPlan } from './conversation-display-plan';
import { projectHistoryWindowItems, projectOwnedHandoffFacts, projectSavedItems, retainUnretiredLiveFacts,
  normalizeTerminalPresenceFacts, scopeIssuedWorkFacts, withPresentationContainers,
  type NormalizedSavedItem, type SavedItemProjection } from './conversation-items';

export interface ConversationSemanticInput {
  readonly isCurrent: () => boolean;
  readonly scope: string;
  readonly canonicalProjection: SavedItemProjection;
  readonly projection: SavedItemProjection;
  readonly decision: OwnUserDecision;
  readonly coverage: ConversationDisplayPlan['coverage'];
}

/** One current semantic recipe for both candidate publication and fixture admission. */
export function captureConversationInput(snapshot: WindowAcceptedSnapshot, input: {
  readonly scope: string; readonly threadId: string; readonly records: readonly HandoffRecord[];
  readonly work: readonly NormalizedSavedItem[]; readonly current: boolean;
}): ConversationSemanticInput {
  const canonicalProjection = projectHistoryWindowItems({ revision: snapshot.revision ?? 0,
    nodes: snapshot.rows, keyScope: [input.scope] }).projection;
  const ownership = snapshot.assistantOwnership ?? [];
  const canonicalOwners = new Set(ownership.filter(item => item.mode === 'canonical').map(item => item.recordKey));
  const reserved = new Set(ownership.filter(item => item.mode === 'preview').flatMap(item => item.itemKeys));
  const handoffs = retainUnretiredLiveFacts(snapshot, input.scope, input.current,
    projectOwnedHandoffFacts(input.threadId, input.current ? input.records : []).filter(fact => !('domain' in fact) || !canonicalOwners.has(fact.recordId)));
  const retained = retainUnretiredLiveFacts(snapshot, input.scope, input.current,
    input.work.filter(fact => !('domain' in fact && fact.namespace === 'handoff')));
  const work = input.current ? scopeIssuedWorkFacts([...retained,
    ...normalizeTerminalPresenceFacts(snapshot.terminalPresence ?? [])], [input.scope]) : undefined;
  const canonical=canonicalProjection.items.filter(item=>!reserved.has(item.key)).map(item=>item.source);
  const rowPositions=new Map(snapshot.rows.filter(row=>!!row.node_id).map(row=>[row.node_id!,row.selection?.ordinal]));
  const positioned=new Map<number,NormalizedSavedItem[]>(),unplaced:NormalizedSavedItem[]=[];
  const pathIndex=(anchor:import('../../data/src/handoff').HandoffPathAnchor):number|undefined=>{
    if(anchor.kind==='beginning')return 0;
    if(rowPositions.get(anchor.nodeId)!==anchor.ordinal)return;
    const next=canonical.findIndex(source=>{const ordinal=source.nodeId?rowPositions.get(source.nodeId):undefined;return ordinal!==undefined&&ordinal>anchor.ordinal;});
    return next<0?canonical.length:next;
  };
  const position=(record:HandoffRecord,seen:Set<string>):number|undefined=>{
    const placement=record.placement;
    if(!placement||placement.scope!==input.scope||seen.has(record.key)||seen.size>=8)return;
    seen.add(record.key);const anchor=placement.anchor;
    if(anchor.kind!=='after-record')return pathIndex(anchor);
    const previous=ownership.find(owner=>owner.recordKey===anchor.recordKey&&owner.containerKey===anchor.container&&owner.mode==='canonical');
    if(previous){const indices=canonical.flatMap((source,index)=>previous.itemKeys.includes(JSON.stringify([source.nodeId,source.itemIdentity]))?[index]:[]);
      if(indices.length)return Math.max(...indices)+1;}
    const held=input.records.find(item=>item.key===anchor.recordKey&&item.presentationContainer===anchor.container);
    return held?position(held,seen):pathIndex(anchor.path);
  };
  for(const fact of handoffs){
    const record='domain' in fact?input.records.find(record=>record.key===fact.recordId):undefined;
    const index=record&&fact.kind==='text'?position(record,new Set()):undefined;
    if(index===undefined){unplaced.push(fact);continue;}
    const group=positioned.get(index)??[];group.push(fact);positioned.set(index,group);
  }
  const ordered:NormalizedSavedItem[]=[];
  for(let index=0;index<=canonical.length;index++){ordered.push(...positioned.get(index)??[]);if(index<canonical.length)ordered.push(canonical[index]!);}
  const projected = projectSavedItems([...ordered,...unplaced,...(work ?? [])]);
  const projection = work === undefined ? Object.freeze({ ...projected,
    partitionUnknownKeys: Object.freeze([...projected.partitionUnknownKeys, 'unavailable-work-cut']) }) : projected;
  const containers = new Map<string, string>();
  for (const item of projection.items) if ('domain' in item.source && item.source.presentationContainer)
    containers.set(item.key, item.source.presentationContainer);
  const keys = new Set(projection.items.map(item => item.key));
  for (const owner of ownership.filter(item => item.mode === 'canonical'))
    for (const key of owner.itemKeys) if (keys.has(key)) containers.set(key, owner.containerKey);
  return { isCurrent: () => true, scope: input.scope, canonicalProjection, projection: withPresentationContainers(projection, containers),
    decision: { cohortVersion: { accepted: [] }, localRegion: emptyOwnSendLocalRegion(input.scope) }, coverage: work === undefined ? 'unavailable' : 'complete' };
}
