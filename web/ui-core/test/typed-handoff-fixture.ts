export interface TypedHandoffFixture {
  readonly threadId: string;
  readonly attemptId: string;
  readonly turnId: string;
  readonly scope: string;
  readonly nodeId: string;
  readonly ordinal: number;
  readonly revision: string | number;
  readonly total: number;
  readonly text: string;
}

export interface TypedHandoffAttempt {
  readonly kind: "attempt";
  readonly id: string;
  readonly attempt_id: string;
  readonly turn_id: string;
  readonly thread_id: string;
  readonly state: "completed";
  readonly response_nodes: readonly [{ readonly ordinal: number; readonly item_id: null; readonly kind: "message"; readonly phase: "final_answer"; readonly node_id: string }];
  readonly response_nodes_truncated: false;
}

export interface TypedHistoryNode {
  readonly node_id: string;
  readonly kind: "assistant_response";
  readonly selection: { readonly ordinal: number };
  readonly excerpt: string;
  readonly items: readonly [{ readonly kind: "text"; readonly item_identity: string; readonly text: string; readonly text_complete: true }];
}

export interface TypedHistoryWindow {
  readonly thread_id: string;
  readonly revision: string | number;
  readonly total: number;
  readonly item_count: number;
  readonly items: readonly [TypedHistoryNode];
}

export function typedHandoff(overrides: Partial<TypedHandoffFixture> = {}): TypedHandoffFixture {
  return {
    threadId: "lead", attemptId: "a1", turnId: "turn1", scope: "lead/a1/turn1",
    nodeId: "canonical-node", ordinal: 300, revision: 2, total: 301,
    text: "Synthetic retained answer.", ...overrides,
  };
}

export function typedAttempt(fixture: TypedHandoffFixture): TypedHandoffAttempt {
  return {
    kind: "attempt", id: fixture.attemptId, attempt_id: fixture.attemptId, turn_id: fixture.turnId,
    thread_id: fixture.threadId, state: "completed",
    response_nodes: [{ ordinal: fixture.ordinal, item_id: null, kind: "message", phase: "final_answer", node_id: fixture.nodeId }],
    response_nodes_truncated: false,
  };
}

export function typedHistoryWindow(fixture: TypedHandoffFixture, args: { node_id?: string; ordinal?: number }): TypedHistoryWindow | undefined {
  if (args.node_id !== undefined && args.node_id !== fixture.nodeId) return;
  if (args.ordinal !== undefined && args.ordinal !== fixture.ordinal) return;
  if (args.node_id === undefined && args.ordinal === undefined) return;
  const node: TypedHistoryNode = {
    node_id: fixture.nodeId, kind: "assistant_response", selection: { ordinal: fixture.ordinal }, excerpt: fixture.text,
    items: [{ kind: "text", item_identity: `${fixture.nodeId}:/output/0/content/0`, text: fixture.text, text_complete: true }],
  };
  return { thread_id: fixture.threadId, revision: fixture.revision, total: fixture.total, item_count: 1, items: [node] };
}

export function validTypedHandoff(fixture: TypedHandoffFixture, attempt: TypedHandoffAttempt, window: TypedHistoryWindow): boolean {
  const ref = attempt.response_nodes[0], node = window.items[0];
  return attempt.attempt_id === fixture.attemptId && attempt.turn_id === fixture.turnId && attempt.thread_id === fixture.threadId
    && ref.node_id === fixture.nodeId && ref.ordinal === fixture.ordinal && node.node_id === ref.node_id
    && node.selection.ordinal === ref.ordinal && window.thread_id === fixture.threadId && window.revision === fixture.revision
    && window.total === fixture.total && window.item_count === window.items.length && node.items[0]?.text === fixture.text;
}

export function typedAttemptMany(fixtures: readonly TypedHandoffFixture[]): TypedHandoffAttempt {
  if (!fixtures.length || fixtures.some((fixture, index) => index > 0 && fixture.ordinal <= fixtures[index - 1]!.ordinal)) throw new Error("Non-monotonic typed handoff refs");
  const first = fixtures[0]!;
  return {
    kind: "attempt", id: first.attemptId, attempt_id: first.attemptId, turn_id: first.turnId,
    thread_id: first.threadId, state: "completed",
    response_nodes: fixtures.map(fixture => ({ ordinal: fixture.ordinal, item_id: null, kind: "message" as const, phase: "final_answer" as const, node_id: fixture.nodeId })) as TypedHandoffAttempt["response_nodes"],
    response_nodes_truncated: false,
  };
}
