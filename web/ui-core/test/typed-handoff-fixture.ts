import type {AttemptId,HistoryItem,HistorySavedItem,HistoryWindowArgs,ResponseNodeRef,WorkItem} from '../../data/src/protocol';

export interface TypedHandoffFixture {
  readonly threadId: string;
  readonly attemptId: string;
  readonly turnId: string;
  readonly scope: string;
  readonly nodeId: string;
  readonly ordinal: number;
  readonly revision: number;
  readonly total: number;
  readonly text: string;
  readonly provenanceAttemptId?: AttemptId;
}

export type TypedHandoffRef = ResponseNodeRef & {readonly kind:'assistant_response'};
export interface TypedHandoffAttempt extends Omit<WorkItem,'kind'|'state'|'response_nodes'> {
 readonly kind:'attempt';readonly id:string;readonly attempt_id:string;readonly turn_id:string;readonly thread_id:string;
 readonly state:'completed';readonly response_nodes:readonly TypedHandoffRef[];readonly response_nodes_truncated:false;
}
export type TypedHistoryNode = HistoryItem & {
 readonly node_id:string;readonly kind:'assistant_response';readonly selection:{readonly ordinal:number};
 readonly items:readonly (Extract<HistorySavedItem,{kind:'text'}>&{readonly text_complete:true})[]|null;
};

export interface TypedHistoryWindow<Node extends HistoryItem=TypedHistoryNode> {
  readonly thread_id: string;
  readonly revision: number;
  readonly total: number;
  readonly item_count: number;
  readonly items: readonly Node[];
}

export function typedHandoff(overrides: Partial<TypedHandoffFixture> = {}): TypedHandoffFixture {
  return {
    threadId: "lead", attemptId: "a1", turnId: "turn1", scope: "lead/a1/turn1",
    nodeId: "canonical-node", ordinal: 300, revision: 2, total: 301,
    text: "Synthetic retained answer.", provenanceAttemptId: undefined, ...overrides,
  };
}

export function typedAttempt(fixture: TypedHandoffFixture): TypedHandoffAttempt {
  return {
    kind: "attempt", id: fixture.attemptId, attempt_id: fixture.attemptId, turn_id: fixture.turnId,
    thread_id: fixture.threadId, state: "completed",
    response_nodes: [{ ordinal: fixture.ordinal, kind: "assistant_response", node_id: fixture.nodeId }],
    response_nodes_truncated: false,
  };
}

export function typedHandoffNode(fixture: TypedHandoffFixture, canonical: boolean): TypedHistoryNode {
  return {
    node_id: fixture.nodeId, kind: "assistant_response", selection: { ordinal: fixture.ordinal }, excerpt: fixture.text,
    items: canonical ? [{ kind: "text", item_identity: `${fixture.nodeId}:/output/0/content/0`, text: fixture.text, text_complete: true }] : null,
    ...(!canonical ? { items_unavailable_reason: "response_budget" as const } : {}),
    ...(canonical && fixture.provenanceAttemptId ? { provenance: { attempt_id: fixture.provenanceAttemptId } } : {}),
  };
}

export function typedHistoryWindow(fixture: TypedHandoffFixture, args: { node_id?: string; ordinal?: number }): TypedHistoryWindow | undefined {
  if (args.node_id !== undefined && args.node_id !== fixture.nodeId) return;
  if (args.ordinal !== undefined && args.ordinal !== fixture.ordinal) return;
  if (args.node_id === undefined && args.ordinal === undefined) return;
  const node = typedHandoffNode(fixture, true);
  return { thread_id: fixture.threadId, revision: fixture.revision, total: fixture.total, item_count: 1, items: [node] };
}

/** The fixture owns a complete declared path; a reply contains only the original requested bounds. */
export function typedSelectedCoverageWindow(threadId:string,revision:number,total:number,items:readonly HistoryItem[],
 args:Pick<HistoryWindowArgs,'node_id'|'ordinal'|'before'|'after'>):TypedHistoryWindow<HistoryItem>{
 if(items.length!==total||items.some((item,index)=>!item.node_id||item.selection?.ordinal!==index))throw new Error('Incomplete declared fixture path');
 const before=args.before??0,after=args.after??0;
 if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after)||before<0||after<0||before+after+1>200)throw new Error('Invalid selected fixture bounds');
 const anchor=args.ordinal??(args.node_id===undefined?Math.max(0,total-1):items.findIndex(item=>item.node_id===args.node_id));
 if(anchor<0||anchor>=total)throw new Error('Missing declared fixture anchor');
 if(args.node_id!==undefined&&items[anchor]?.node_id!==args.node_id)throw new Error('Mismatched declared fixture anchor');
 const selected=items.slice(Math.max(0,anchor-before),Math.min(total,anchor+after+1));
 return{thread_id:threadId,revision,total,item_count:selected.length,items:selected};
}

export function validTypedHandoffRef<Node extends HistoryItem>(fixture: TypedHandoffFixture, attempt: TypedHandoffAttempt, window: TypedHistoryWindow<Node>): boolean {
  const ref = attempt.response_nodes.find(candidate => candidate.node_id === fixture.nodeId && candidate.ordinal === fixture.ordinal);
  const node = window.items.find(candidate => candidate.node_id === ref?.node_id);
  return !!ref && attempt.attempt_id === fixture.attemptId && attempt.turn_id === fixture.turnId && attempt.thread_id === fixture.threadId
    && node?.node_id === ref.node_id && node.selection?.ordinal === ref.ordinal && window.thread_id === fixture.threadId
    && window.revision === fixture.revision && window.total === fixture.total && window.item_count === window.items.length
    && node.items?.[0]?.kind==='text' && node.items[0].text===fixture.text;
}

export function validTypedHandoff(fixture: TypedHandoffFixture, attempt: TypedHandoffAttempt, window: TypedHistoryWindow): boolean {
  return validTypedHandoffRef(fixture, attempt, window);
}

export interface TypedHandoffRegistryRef { readonly nodeId: string; readonly ordinal: number; readonly text: string }
export interface TypedHandoffRegistry {
  readonly threadId: string; readonly attemptId: string; readonly turnId: string; readonly scope: string;
  readonly refs: readonly TypedHandoffFixture[];
  revision: number; total: number; canonical: boolean;
  attempt(): TypedHandoffAttempt;
  history(args: { node_id?: string; ordinal?: number; before?: number; after?: number }): TypedHistoryWindow | undefined;
}

export function typedHandoffRegistry(input: { threadId: string; attemptId: string; turnId: string; revision: number; total: number; refs: readonly TypedHandoffRegistryRef[]; provenanceAttemptId?: AttemptId }): TypedHandoffRegistry {
  if (!input.refs.length || input.refs.some((ref, index) => index > 0 && ref.ordinal <= input.refs[index - 1]!.ordinal)) throw new Error("Non-monotonic typed handoff refs");
  const scope = `${input.threadId}/${input.attemptId}/${input.turnId}`;
  const refs = input.refs.map(ref => typedHandoff({ threadId: input.threadId, attemptId: input.attemptId, turnId: input.turnId, scope, nodeId: ref.nodeId, ordinal: ref.ordinal, revision: input.revision, total: input.total, text: ref.text, provenanceAttemptId: input.provenanceAttemptId }));
  const registry: TypedHandoffRegistry = {
    threadId: input.threadId, attemptId: input.attemptId, turnId: input.turnId, scope, refs,
    revision: input.revision, total: input.total, canonical: false,
    attempt: () => typedAttemptMany(refs),
    history: args => {
      const selected = refs.filter(ref => (args.node_id === undefined || args.node_id === ref.nodeId) && (args.ordinal === undefined || args.ordinal === ref.ordinal));
      if (args.node_id === undefined && args.ordinal === undefined) {
        if (args.before === undefined && args.after === undefined) return;
        return undefined;
      }
      if (selected.length !== 1) return;
      const anchor = selected[0]!;
      const before = args.before ?? 0, after = args.after ?? 0;
      const rows = refs.filter(ref => ref.ordinal >= anchor.ordinal - before && ref.ordinal <= anchor.ordinal + after)
        .map(ref => typedHandoffNode(ref, registry.canonical));
      return { thread_id: registry.threadId, revision: registry.revision, total: registry.total, item_count: rows.length, items: rows };
    },
  };
  return registry;
}

export function typedAttemptMany(fixtures: readonly TypedHandoffFixture[]): TypedHandoffAttempt {
  if (!fixtures.length || fixtures.some((fixture, index) => index > 0 && fixture.ordinal <= fixtures[index - 1]!.ordinal)) throw new Error("Non-monotonic typed handoff refs");
  const first = fixtures[0]!;
  return { kind: "attempt", id: first.attemptId, attempt_id: first.attemptId, turn_id: first.turnId, thread_id: first.threadId, state: "completed",
    response_nodes: fixtures.map(fixture => ({ ordinal: fixture.ordinal, kind: "assistant_response" as const, node_id: fixture.nodeId })), response_nodes_truncated: false };
}

export interface TypedReadyRefreshFixture {
  readonly threadId: string; readonly revision: number; readonly initialTotal: number; readonly total: number;
  readonly ordinal: number; readonly nodeId: string; readonly text: string; readonly attempt: TypedHandoffAttempt;
  readonly initialItems: readonly HistoryItem[]; readonly appendedItems: readonly HistoryItem[];
  readonly phase: 'initial'|'appended'; readonly currentRevision: number; readonly currentTotal: number;
  advance(): void;
  read(args?: Pick<HistoryWindowArgs, 'node_id'|'ordinal'|'before'|'after'>): TypedHistoryWindow<HistoryItem>;
}

/** Builds the same complete 300 -> 301 selection path for model and browser fixtures. */
export function typedReadyRefreshFixture(input: {threadId: string; attemptId: string; turnId: string; revision: number; nodeId: string; text: string}): TypedReadyRefreshFixture {
  const initialTotal = 300, total = 301, ordinal = 300;
  const initialItems: HistoryItem[] = Array.from({length: initialTotal}, (_, index) => ({
    node_id: `history-${index}`, kind: 'assistant_response', selection: {ordinal: index},
    items: [{kind: 'text', item_identity: `history-${index}:text`, text: `history-${index}`, text_complete: true}],
  }));
  const appendedNode = typedHandoffNode(typedHandoff({threadId: input.threadId, attemptId: input.attemptId, turnId: input.turnId, nodeId: input.nodeId, ordinal, revision: input.revision, total, text: input.text, provenanceAttemptId: input.attemptId as AttemptId}), true);
  const appendedItems = [...initialItems, appendedNode];
  const attempt = typedAttempt(typedHandoff({threadId: input.threadId, attemptId: input.attemptId, turnId: input.turnId, nodeId: input.nodeId, ordinal, revision: input.revision, total, text: input.text, provenanceAttemptId: input.attemptId as AttemptId}));
  let phase: 'initial'|'appended' = 'initial';
  const read = (args: Pick<HistoryWindowArgs, 'node_id'|'ordinal'|'before'|'after'> = {}) => {
    const items = phase === 'initial' ? initialItems : appendedItems;
    const revision = phase === 'initial' ? input.revision : input.revision + 1;
    const currentTotal = phase === 'initial' ? initialTotal : total;
    const selectedArgs = args.node_id === undefined && args.ordinal === undefined
      ? {ordinal: currentTotal - 1, before: args.before ?? 0, after: args.after ?? 0}
      : args;
    return typedSelectedCoverageWindow(input.threadId, revision, currentTotal, items, selectedArgs);
  };
  return {threadId: input.threadId, revision: input.revision, initialTotal, total, ordinal, nodeId: input.nodeId, text: input.text, attempt, initialItems, appendedItems,
    get phase(){return phase;}, get currentRevision(){return phase === 'initial' ? input.revision : input.revision + 1;}, get currentTotal(){return phase === 'initial' ? initialTotal : total;},
    advance:()=>{phase='appended';}, read};
}
