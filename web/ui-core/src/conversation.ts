import { canonicalItemCase, projectHistoryWindowItems } from "./conversation-items";
import { senderFact } from "../../data/src/sender";
// Pure rendering from strictly decoded selected-path history-window DTOs.
import { type HistoryItem, type ShellEntry, HISTORY_WINDOW_EXCERPT_CHARS } from "../../data/src/protocol";
import { parseTime } from "./format";
import { statusOfShell, type StatusKey } from "./status";

export interface StepRow {
  executionId: string;
  command: string;
  /** The model's one-line account of the call, when the owner reports it. */
  description?: string;
  commandTruncated: boolean;
  status: StatusKey | undefined;
  state: string | undefined;
  exitCode: number | null | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  /** Measured from saved times. Undefined until the shell has both. */
  durationMs: number | undefined;
  cwd: string | undefined;
}

export type Speaker = { kind: "model"; threadId: string; label?: string } | { kind: "unknown"; model: boolean; label?: string } | { kind: "you" } | { kind: "shellboy" } | { kind: "cli" } | { kind: "other"; label: string };

export type ConversationRow =
  | { type: "publication"; id: string; state: "tool" | "unknown"; attemptId?: string; ordinal?: number; kind?: string; error?: boolean }
  | { type: "message"; id: string; speaker: Speaker; text: string; truncated: boolean; at: string | undefined }
  | { type: "steps"; id: string; steps: StepRow[]; entries: ({ kind: "step"; step: StepRow } | { kind: "compacted"; id: string; text: string })[] }
  | { type: "note"; id: string; kind: string; text: string; at: string | undefined };


function speakerOf(item: HistoryItem): Speaker {
  if (item.kind === "assistant_response") return { kind: "shellboy" };
  const sender = senderFact(item.provenance?.sender);
  if (sender.kind === "human") return { kind: "you" };
  if (sender.kind === "external_cli") return sender.label?.trim() ? { kind: "other", label: `CLI: ${sender.label}` } : { kind: "cli" };
  if (sender.kind === "model") return sender;
  if (sender.kind === "unknown_model") return { kind: "unknown", model: true, label: sender.label };
  return { kind: "unknown", model: false, label: sender.label };
}

const codePoints = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Execution facts are side metadata, never a source of semantic node classification. */
export function collectExecutionSteps(items: readonly HistoryItem[], shells: ReadonlyMap<string, ShellEntry> = new Map()): StepRow[] {
  const steps: StepRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const executions = item.executions ?? [];
    for (const e of executions) {
      if (seen.has(e.execution_id)) continue;
      seen.add(e.execution_id);
      const fact = shells.get(e.execution_id);
      const state = fact?.state ?? e.state;
      const startedAt = fact?.started_at;
      const endedAt = fact?.ended_at;
      const start = parseTime(startedAt);
      const end = parseTime(endedAt);
      steps.push({
        executionId: e.execution_id,
        command: e.command_excerpt ?? fact?.command_excerpt ?? "",
        ...(typeof e.description === "string" && e.description !== "" ? { description: e.description } : {}),
        commandTruncated: e.command_truncated === true || fact?.command_excerpt_truncated === true,
        status: statusOfShell(state, fact?.exit_code),
        state,
        exitCode: fact?.exit_code,
        startedAt,
        endedAt,
        durationMs: start !== undefined && end !== undefined ? end - start : undefined,
        cwd: e.cwd,
      });
    }
  }
  return steps;
}

export interface HistoryPresentation {
  readonly projection: ReturnType<typeof projectHistoryWindowItems>["projection"];
  readonly rows: ConversationRow[];
  readonly steps: StepRow[];
  /** Actual canonical provenance for view/measurement, not a position-derived key. */
  readonly nodeIdByRowId: ReadonlyMap<string, string>;
}
/** Presentation only: canonical semantic order is produced once for the whole input. */
export function materializeHistoryPresentation(items: readonly HistoryItem[], shells: ReadonlyMap<string, ShellEntry> = new Map(), revision: string | number = 0): HistoryPresentation {
  const projection = projectHistoryWindowItems({ revision, nodes: items }).projection;
  const rows: ConversationRow[] = [];
  const nodes = new Map(items.map(node => [node.node_id, node]));
  const nodeIdByRowId = new Map<string, string>();
  const count = new Map<string, number>();
  for (const item of projection.items) if (item.source.nodeId) count.set(item.source.nodeId, (count.get(item.source.nodeId) ?? 0) + 1);
  for (const item of projection.items) {
    const nodeId = item.source.nodeId;
    const node = nodes.get(nodeId);
    if (!node || !nodeId) continue;
    const id = count.get(nodeId) === 1 ? nodeId : item.key;
    nodeIdByRowId.set(id, nodeId);
    const source = item.source;
    const at = node.provenance?.created_at;
    const render = (item.classification ?? canonicalItemCase(source)).render;
    switch (render) {
      case "human-message": case "received-model": case "received-cli": case "received-unknown": case "model-message": case "summary":
        rows.push({ type: "message", id, speaker: speakerOf(node), text: "text" in source ? source.text : "", truncated: source.kind === "text" && source.textComplete === false, at });
        break;
      case "tool": case "compressed-tool": case "thinking": case "thinking-marker": case "state-change": case "stream-change": case "notification": case "child-notification": case "shell-notification": case "interruption": case "unsupported": case "unavailable": case "empty-ordinary":
        rows.push({ type: "note", id, kind: source.kind, text: "", at });
        break;
      default: { const unreachable: never = render; throw new Error(`Unhandled canonical render: ${unreachable}`); }
    }
  }
  const steps = collectExecutionSteps(items, shells);
  // Attach side metadata to actual nodes without changing canonical semantic decisions.
  const emitted = new Set<string>();
  const stepById = new Map(steps.map(step => [step.executionId, step]));
  for (const node of items) {
    const selected = (node.executions ?? []).flatMap(execution => {
      const step = stepById.get(execution.execution_id);
      if (!step || emitted.has(step.executionId)) return [];
      emitted.add(step.executionId); return [step];
    });
    if (!selected.length) continue;
    const nodeId = node.node_id ?? "";
    const id = `execution-facts:${nodeId}`;
    nodeIdByRowId.set(id, nodeId);
    const after = rows.map(row => nodeIdByRowId.get(row.id)).lastIndexOf(nodeId);
    rows.splice(after < 0 ? rows.length : after + 1, 0, { type: "steps", id, steps: selected, entries: selected.map(step => ({ kind: "step", step })) });
  }
  return { projection, rows, steps, nodeIdByRowId };
}

/**
 * Where to show a branch mark. A divergence on a node with no row of its own (a tool result, a bookkeeping
 * node) goes on the row before it: everything above that row is shared. A node outside the items read shows
 * nothing, rather than a mark in the wrong place.
 */
export function branchRowMarks(items: readonly HistoryItem[], rows: readonly ConversationRow[], marks: ReadonlyMap<string, number>): Map<string, { nodeId: string; branches: number }> {
  const out = new Map<string, { nodeId: string; branches: number }>();
  if (marks.size === 0) return out;
  const rowIds = new Set(rows.map((r) => r.id));
  let lastRow: string | undefined;
  for (const item of items) {
    const id = item.node_id;
    if (id === undefined) continue;
    if (rowIds.has(id)) lastRow = id;
    const branches = marks.get(id);
    if (branches === undefined || lastRow === undefined) continue;
    const had = out.get(lastRow);
    out.set(lastRow, { nodeId: id, branches: (had?.branches ?? 0) + branches });
  }
  return out;
}
