import { CANONICAL_CASES, workDisplayMetadata, type CanonicalCase, type ProjectedSavedItem } from "./conversation-items";
export type WorkTypeIcon = NonNullable<CanonicalCase["icon"]>;
export interface WorkElementDisplay {
  readonly typeIcon: WorkTypeIcon;
  readonly typeAccessibleLabel: string;
  readonly contentLabel: { readonly text: string; readonly context: readonly { readonly name: string; readonly value: string }[] };
  readonly state: { readonly source: "wire" | "client"; readonly value: string; readonly exitCode?: number | null } | null;
  readonly detailPolicy: "none" | "unavailable" | "actual-safe-typed" | "existing-shell-output";
}
/** Display facts are issued with normalized source objects, never joined in JSX. */
export function workElementDisplay(item: ProjectedSavedItem): WorkElementDisplay | undefined {
  return display(item);
}
/** Select only an execution already associated by this item's original issuer. */
export function workExecutionDisplay(item: ProjectedSavedItem, executionId: string): WorkElementDisplay | undefined {
  const facts = workDisplayMetadata(item);
  if (!facts || !facts.shells.some(shell => shell.execution_id === executionId)) return undefined;
  return display(item, executionId);
}
function display(item: ProjectedSavedItem, executionId?: string): WorkElementDisplay | undefined {
  const facts = workDisplayMetadata(item), c = item.classification;
  if (!facts || !c || c !== CANONICAL_CASES[c.id] || c.classification !== "work" || !("displayPolicy" in c)) return undefined;
  const source = item.source;
  const context: { name: string; value: string }[] = [];
  if (facts.nodeKind) context.push({ name: "kind", value: facts.nodeKind });
  if (facts.createdAt) context.push({ name: "created_at", value: facts.createdAt });
  let text: string, label: string;
  const icon: WorkTypeIcon = c.icon;
  let state: WorkElementDisplay["state"] = facts.publicState ? { source: "wire", value: facts.publicState } : null, detail: WorkElementDisplay["detailPolicy"] = "unavailable";
  switch (c.displayPolicy) {
    case "associated-tool": {
      label = "Tool";
      const shells = executionId === undefined ? facts.shells : facts.shells.filter(shell => shell.execution_id === executionId);
      if (shells.length) {
        text = shells.map(shell => shell.command_excerpt?.trim() || "Execution content was not provided").join("; ");
        const first = shells[0]!;
        state = first.state ? { source: "wire", value: first.state, ...(first.exit_code !== undefined ? { exitCode: first.exit_code } : {}) } : null;
        detail = "existing-shell-output";
        for (const shell of shells) {
          context.push({ name: "execution_id", value: shell.execution_id });
          if (shell.description) context.push({ name: "description", value: shell.description });
        }
      } else {
        text = source.kind === "tool" && source.compressed ? "Compressed; execution content was not provided" : "Execution content was not provided";
        if (source.kind === "tool" && source.callId) context.push({ name: "call_id", value: source.callId });
      }
      break;
    }
    case "reasoning-unavailable": label = "Reasoning"; text = "Reasoning content is not publicly available"; break;
    case "notification-context": label = "Notification"; text = facts.createdAt ? `A content summary was not provided (${facts.createdAt})` : "A content summary was not provided"; break;
    case "problem-context": label = "Response state"; text = "Response-state details were not provided"; break;
    case "wire-problem": {
      label = "Unavailable item";
      const reason = source.kind === "unavailable" ? source.reason : undefined;
      text = reason === "response_budget" ? "Display data exceeded this response's read budget" : "Display content is unavailable";
      if (reason) { state = { source: "wire", value: reason }; context.push({ name: "reason", value: reason }); }
      break;
    }
    case "unknown-problem": label = "Unsupported item"; text = facts.nodeKind ? "Item details are not supported" : "The item kind was not provided"; break;
    case "client-terminal": {
      label = "Saved-history confirmation";
      const presence = facts.receipt;
      if (!presence || !("domain" in source) || source.terminalPresence !== presence) return undefined;
      state = { source: "client", value: presence.reason };
      context.push({ name: "client_reason", value: presence.reason });
      text = presence.phase === "reading" ? "Checking saved content" : presence.phase === "pending" ? "Saved content is awaiting confirmation" : "Saved content could not be fully confirmed";
      detail = "none";
      break;
    }
  }
  return Object.freeze({ typeIcon: icon, typeAccessibleLabel: label, contentLabel: Object.freeze({ text, context: Object.freeze(context.map(value => Object.freeze(value))) }), state: state ? Object.freeze(state) : null, detailPolicy: detail });
}
