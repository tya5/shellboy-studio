import { classifySavedHistoryFact } from "./conversation-items";
import { senderFact } from "../../data/src/sender";
// Legacy row compatibility; semantic classification is shared with typed projection.
import { HISTORY_EXCERPT_CHARS, type HistoryItem, type ShellEntry } from "../../data/src";
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

export function projectConversation(items: HistoryItem[], shells: ReadonlyMap<string, ShellEntry> = new Map()): ConversationRow[] {
  const rows: ConversationRow[] = [];
  const seen = new Set<string>();
  const addStep = (id: string, step: StepRow) => {
    const last = rows[rows.length - 1];
    if (last?.type === "steps") { last.steps.push(step); last.entries.push({ kind: "step", step }); }
    else rows.push({ type: "steps", id, steps: [step], entries: [{ kind: "step", step }] });
  };
  for (const item of items) {
    const id = item.node_id ?? "";
    if (item.kind === "spill") {
      const entry = { kind: "compacted" as const, id, text: item.excerpt ?? "" };
      const last = rows[rows.length - 1];
      if (last?.type === "steps") last.entries.push(entry);
      else rows.push({ type: "steps", id, steps: [], entries: [entry] });
      continue;
    }
    const executions = item.executions ?? [];
    if (executions.length > 0) {
      for (const e of executions) {
        if (seen.has(e.execution_id)) continue;
        seen.add(e.execution_id);
        const fact = shells.get(e.execution_id);
        const state = fact?.state ?? e.state;
        const startedAt = fact?.started_at;
        const endedAt = fact?.ended_at;
        const start = parseTime(startedAt);
        const end = parseTime(endedAt);
        addStep(id, {
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
      if (item.kind !== "assistant_response" || !item.excerpt) continue;
      const safeText = item.items?.filter(entry => entry.kind === "text");
      if (safeText?.length) rows.push({ type: "message", id: `${id}:commentary`, speaker: speakerOf(item), text: safeText.map(entry => entry.text).join("\n"), truncated: safeText.some(entry => !entry.text_complete), at: item.provenance?.created_at });
      else rows.push({ type: "publication", id: `${id}:unknown`, state: "unknown" });
      continue;
    }
    const safeText = item.items?.filter(entry => entry.kind === "text");
    const classification = classifySavedHistoryFact(item.kind, safeText?.length ? "text" : item.items === null ? "deferred" : item.items?.length === 0 ? "empty" : "legacy", !!item.items_unavailable_reason);
    const at = item.provenance?.created_at;
    if (classification === "text" || classification === "user" || classification === "summary") {
      const text = safeText?.length ? safeText.map(entry => entry.text).join("\n") : classification === "user" ? item.excerpt ?? "" : "";
      rows.push({ type: "message", id, speaker: speakerOf(item), text, truncated: safeText?.some(entry => !entry.text_complete) ?? false, at });
    } else rows.push({ type: "note", id, kind: item.kind ?? "unknown", text: "", at });
  }
  return rows;
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
