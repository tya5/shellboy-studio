import { statusOfShell, type StatusKey } from "./status";
import { CANONICAL_CASES, workDisplayMetadata, type NormalizedSavedItem, type WorkDisplayMetadata, type CanonicalCase, type ProjectedSavedItem } from "./conversation-items";
export type WorkTypeIcon = NonNullable<CanonicalCase["icon"]>;
export interface WorkElementDisplay {
  readonly typeIcon: WorkTypeIcon;
  readonly typeAccessibleLabel: string;
  readonly contentLabel: { readonly text: string; readonly context: readonly { readonly name: string; readonly value: string }[] };
  readonly state: { readonly source: "wire" | "client"; readonly value: string; readonly executionStatus?: StatusKey; readonly exitCode?: number | null } | null;
  readonly detailPolicy: "none" | "unavailable" | "actual-safe-typed" | "existing-shell-output";
}
/** Issuer-qualified inputs captured inside the capability-bound accepted plan. */
export interface CapturedWorkElement {
  readonly key: string;
  readonly source: NormalizedSavedItem;
  readonly classification: Extract<CanonicalCase, { readonly classification: "work" }>;
  readonly metadata: WorkDisplayMetadata;
}
export function captureWorkElement(item: ProjectedSavedItem): CapturedWorkElement | undefined {
  const facts = workDisplayMetadata(item), c = item.classification;
  if (!facts || !c || c !== CANONICAL_CASES[c.id] || c.classification !== "work" || !("displayPolicy" in c)) return;
  return Object.freeze({ key: item.key, source: item.source, classification: c, metadata: facts });
}

/** Direct issuer path, for pre-publication composition only. */
export function workElementDisplay(item: ProjectedSavedItem): WorkElementDisplay | undefined {
  return capturedWorkElementDisplay(item, captureWorkElement(item));
}
export function workExecutionDisplay(item: ProjectedSavedItem, executionId: string): WorkElementDisplay | undefined {
  return capturedWorkExecutionDisplay(item, captureWorkElement(item), executionId);
}

/** Caller qualifies the containing accepted reference/capability; no proof is reissued here. */
export function capturedWorkElementDisplay(item: ProjectedSavedItem, capture: CapturedWorkElement | undefined): WorkElementDisplay | undefined {
  if (!capture || capture.key !== item.key || capture.source !== item.source
    || capture.classification !== item.classification || capture.metadata.scopeKey !== JSON.stringify(item.source.keyScope ?? [])) return;
  return display(item, capture);
}
export function capturedWorkExecutionDisplay(item: ProjectedSavedItem, capture: CapturedWorkElement | undefined, executionId: string): WorkElementDisplay | undefined {
  if (!capture?.metadata.shells.some(shell => shell.execution_id === executionId)) return;
  if (!capturedWorkElementDisplay(item, capture)) return;
  return display(item, capture, executionId);
}
function display(item: ProjectedSavedItem, capture: CapturedWorkElement, executionId?: string): WorkElementDisplay | undefined {
  const facts = capture.metadata, c = capture.classification;
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
      const descriptor = facts.descriptor;
      const name = descriptor?.name_state === "available" ? descriptor.name : undefined;
      if (descriptor) {
        context.push({ name: "call_id_state", value: descriptor.call_id_state }, { name: "name_state", value: descriptor.name_state });
        if (descriptor.call_id_state === "available" && descriptor.call_id) context.push({ name: "call_id", value: descriptor.call_id });
      }
      if (facts.detailAvailability) context.push({ name: "detail_availability", value: facts.detailAvailability });
      const shells = executionId === undefined ? facts.shells : facts.shells.filter(shell => shell.execution_id === executionId);
      if (shells.length) {
        text = shells.map(shell => shell.description?.trim() ? shell.description : shell.command_excerpt?.trim() ? shell.command_excerpt : name ?? "Execution content was not provided").join("; ");
        const first = shells[0]!;
        // An exit code the history link does not carry is unknown, not a failure.
        const executionStatus = first.state === "exited" && first.exit_code === undefined ? undefined : statusOfShell(first.state, first.exit_code);
        state = first.state ? { source: "wire", value: first.state, ...(executionStatus ? { executionStatus } : {}), ...(first.exit_code !== undefined ? { exitCode: first.exit_code } : {}) } : null;
        detail = "existing-shell-output";
        for (const shell of shells) {
          context.push({ name: "execution_id", value: shell.execution_id });
        }
      } else {
        text = name ?? (source.kind === "tool" && source.compressed ? "Compressed; execution content was not provided" : "Execution content was not provided");
        if (source.kind === "tool" && source.callId) context.push({ name: "call_id", value: source.callId });
      }
      break;
    }
    case "reasoning-unavailable": label = "Reasoning"; text = "Reasoning content is not publicly available"; break;
    case "notification-context": {
      label = "Notification";
      const notification = facts.notification;
      if (!notification) {
        text = "Notification details were not provided";
        break;
      }
      switch (notification.kind) {
        case "turn_started": text = "Turn started"; break;
        case "recovery_resumed": text = "Recovery resumed"; break;
        case "instructions_observed":
          text = { first_seen: "Instructions observed", updated: "Instructions updated", removed: "Instructions removed" }[notification.observation];
          break;
        case "thread_settings_changed":
          text = "Thread settings changed";
          for (const field of notification.changed_fields) context.push({ name: "changed_field", value: field });
          break;
        case "shell_ended":
          text = "Shell execution ended";
          context.push({ name: "execution_id", value: notification.execution_id });
          state = { source: "wire", value: notification.state,
            ...(notification.exit_code !== undefined ? { exitCode: notification.exit_code } : {}) };
          break;
      }
      break;
    }
    case "problem-context": label = "Response state"; text = "Response-state details were not provided"; break;
    case "wire-problem": {
      label = "Unavailable item";
      const reason = source.kind === "unavailable" ? source.reason : undefined;
      text = reason === "response_budget" ? "Display data exceeded this response's read budget" : "Display content is unavailable";
      if (reason) { state = { source: "wire", value: reason }; context.push({ name: "reason", value: reason }); }
      break;
    }
    case "live-activity":
      if (!("domain" in source) || source.domain !== "live" || (facts.nodeKind !== "run" && facts.nodeKind !== "turn")) return undefined;
      label = "Activity"; text = facts.nodeKind === "run" ? "Run" : "Turn"; detail = "none"; break;
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
