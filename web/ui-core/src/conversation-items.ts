import type { TerminalPresence } from "./terminal-presence";
import type { HistoryItem, HistorySavedItem, HistoryItemsUnavailableReason, WorkItem, ToolDescriptor, ToolDetailAvailability, NotificationDescriptor } from "../../data/src/protocol";
/** Internal normalized contract only. Not a Core wire type or a body adapter. */
export type WorkCategory = "Tools" | "Reasoning" | "Notifications" | "Problems";
export const CANONICAL_CASES = {
  terminalPending: { displayPolicy: "client-terminal", id: "terminalPending", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "notification", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  terminalReading: { displayPolicy: "client-terminal", id: "terminalReading", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "notification", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  terminalSettled: { displayPolicy: "client-terminal", id: "terminalSettled", normalizedKind: "record", classification: "work", headingCategory: "Problems", render: "unsupported", keyPolicy: "canonical", icon: "file", openPolicy: "closed", toolPolicy: "none" },
  human: { id: "human", normalizedKind: "user", classification: "conversation", headingCategory: null, render: "human-message", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
  receivedModel: { id: "receivedModel", normalizedKind: "user", classification: "conversation", headingCategory: null, render: "received-model", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
  receivedCli: { id: "receivedCli", normalizedKind: "user", classification: "conversation", headingCategory: null, render: "received-cli", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
  receivedUnknown: { id: "receivedUnknown", normalizedKind: "user", classification: "conversation", headingCategory: null, render: "received-unknown", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
  assistantText: { id: "assistantText", normalizedKind: "text", classification: "conversation", headingCategory: null, render: "model-message", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
  toolCall: { displayPolicy: "associated-tool", id: "toolCall", normalizedKind: "tool", classification: "work", headingCategory: "Tools", render: "tool", keyPolicy: "association", icon: "cube", openPolicy: "closed", toolPolicy: "explicit-association" },
  readableReasoning: { displayPolicy: "reasoning-unavailable", id: "readableReasoning", normalizedKind: "reasoning", classification: "work", headingCategory: "Reasoning", render: "thinking", keyPolicy: "canonical", icon: "bot", openPolicy: "closed", toolPolicy: "none" },
  reasoningMarker: { displayPolicy: "reasoning-unavailable", id: "reasoningMarker", normalizedKind: "reasoning_unavailable", classification: "work", headingCategory: "Reasoning", render: "thinking-marker", keyPolicy: "canonical", icon: "bot", openPolicy: "closed", toolPolicy: "none" },
  toolResult: { displayPolicy: "associated-tool", id: "toolResult", normalizedKind: "tool", classification: "work", headingCategory: "Tools", render: "tool", keyPolicy: "association", icon: "cube", openPolicy: "closed", toolPolicy: "explicit-association" },
  spill: { displayPolicy: "associated-tool", id: "spill", normalizedKind: "tool", classification: "work", headingCategory: "Tools", render: "compressed-tool", keyPolicy: "association", icon: "cube", openPolicy: "closed", toolPolicy: "explicit-association" },
  summary: { id: "summary", normalizedKind: "summary", classification: "conversation", headingCategory: null, render: "summary", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
  event: { displayPolicy: "notification-context", id: "event", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "notification", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  context: { displayPolicy: "notification-context", id: "context", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "state-change", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  observation: { displayPolicy: "notification-context", id: "observation", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "stream-change", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  notification: { displayPolicy: "notification-context", id: "notification", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "notification", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  childNotification: { displayPolicy: "notification-context", id: "childNotification", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "child-notification", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  shellNotification: { displayPolicy: "notification-context", id: "shellNotification", normalizedKind: "record", classification: "work", headingCategory: "Notifications", render: "shell-notification", keyPolicy: "canonical", icon: "inbox", openPolicy: "closed", toolPolicy: "none" },
  interruptionDetails: { displayPolicy: "problem-context", id: "interruptionDetails", normalizedKind: "interruption", classification: "work", headingCategory: "Problems", render: "interruption", keyPolicy: "canonical", icon: "cross", openPolicy: "closed", toolPolicy: "none" },
  interruptionContext: { displayPolicy: "problem-context", id: "interruptionContext", normalizedKind: "interruption", classification: "work", headingCategory: "Problems", render: "interruption", keyPolicy: "canonical", icon: "cross", openPolicy: "closed", toolPolicy: "none" },
  incompleteResponse: { displayPolicy: "problem-context", id: "incompleteResponse", normalizedKind: "interruption", classification: "work", headingCategory: "Problems", render: "interruption", keyPolicy: "canonical", icon: "cross", openPolicy: "closed", toolPolicy: "none" },
  interruptedWait: { displayPolicy: "problem-context", id: "interruptedWait", normalizedKind: "interruption", classification: "work", headingCategory: "Problems", render: "interruption", keyPolicy: "canonical", icon: "cross", openPolicy: "closed", toolPolicy: "none" },
  legacyUnknown: { displayPolicy: "unknown-problem", id: "legacyUnknown", normalizedKind: "record", classification: "work", headingCategory: "Problems", render: "unsupported", keyPolicy: "canonical", icon: "file", openPolicy: "closed", toolPolicy: "none" },
  unavailable: { displayPolicy: "wire-problem", id: "unavailable", normalizedKind: "unavailable", classification: "work", headingCategory: "Problems", render: "unavailable", keyPolicy: "canonical", icon: "file", openPolicy: "closed", toolPolicy: "none" },
  unknown: { displayPolicy: "unknown-problem", id: "unknown", normalizedKind: "record", classification: "work", headingCategory: "Problems", render: "unsupported", keyPolicy: "canonical", icon: "file", openPolicy: "closed", toolPolicy: "none" },
  ordinaryEmpty: { id: "ordinaryEmpty", normalizedKind: "ordinaryEmpty", classification: "conversation", headingCategory: null, render: "empty-ordinary", keyPolicy: "canonical", icon: null, openPolicy: "closed", toolPolicy: "none" },
} as const;
export type CanonicalCaseId = keyof typeof CANONICAL_CASES;
export type CanonicalCase = typeof CANONICAL_CASES[CanonicalCaseId];

type IssuedNotification = { [K in NotificationDescriptor["kind"]]:
  Extract<NotificationDescriptor, { kind: K }> extends infer T
    ? { readonly [P in keyof T]: T[P] extends (infer V)[] ? readonly V[] : T[P] } : never
}[NotificationDescriptor["kind"]];
function issueNotification(value: NotificationDescriptor | undefined): IssuedNotification | undefined {
  if (!value) return undefined;
  return value.kind === "thread_settings_changed"
    ? Object.freeze({ ...value, changed_fields: Object.freeze([...value.changed_fields]) })
    : Object.freeze({ ...value });
}
export interface WorkDisplayMetadata {
  readonly notification?: IssuedNotification;
  readonly descriptor?: ToolDescriptor;
  readonly detailAvailability?: ToolDetailAvailability;
  readonly scopeKey: string;
  readonly nodeKind?: string;
  readonly createdAt?: string;
  readonly publicState?: string;
  readonly shells: readonly Readonly<{ execution_id: string; description?: string; command_excerpt?: string; state?: string; exit_code?: number | null }>[];
  readonly receipt?: TerminalPresence;
}
function associatedDisplayShells(node: HistoryItem, ids: readonly string[]): WorkDisplayMetadata["shells"] {
  if (ids.length > 64 || (node.executions?.length ?? 0) > 64) return Object.freeze([]);
  return (node.executions ?? []).filter(shell => ids.includes(shell.execution_id)).map(shell => Object.freeze({
        execution_id: shell.execution_id, state: shell.state,
        ...(shell.description !== undefined ? { description: shell.description } : {}),
        ...(shell.command_excerpt !== undefined ? { command_excerpt: shell.command_excerpt } : {}),
        ...((typeof shell.exit_code === "number" && Number.isFinite(shell.exit_code)) || shell.exit_code === null ? { exit_code: shell.exit_code } : {}) }));
}
const displayMetadata = new WeakMap<object, WorkDisplayMetadata>();
const displayIdentity = new WeakMap<object, string>();
function metadataIdentity(source: NormalizedSavedItem): string {
  return JSON.stringify([source.keyScope, source.nodeId, source.itemIdentity, source.kind,
    source.kind === "tool" ? [source.executionIds, source.executionId, source.callId] : null,
    "domain" in source ? [source.domain, source.scope, source.recordId, source.attemptId, source.domain === "receipt" ? source.terminalPresence : null] : null]);
}
function issueDisplayMetadata(source: NormalizedSavedItem, facts: WorkDisplayMetadata): void {
  displayMetadata.set(source, facts); displayIdentity.set(source, metadataIdentity(source));
}
function preserveDisplayMetadata(from: NormalizedSavedItem, to: NormalizedSavedItem): void {
  const facts = displayMetadata.get(from);
  if (facts && displayIdentity.get(from) === metadataIdentity(from) && metadataIdentity(from) === metadataIdentity(to)
    && facts.scopeKey === JSON.stringify(to.keyScope ?? [])) issueDisplayMetadata(to, facts);
}
/** Scope only issuer-owned Work facts; saved/body facts must remain untouched. */
export function scopeIssuedWorkFacts(items: readonly NormalizedSavedItem[], keyScope: readonly string[]): readonly NormalizedSavedItem[] | undefined {
  if (!keyScope.length || keyScope.some(part => typeof part !== "string" || !part.length)) return undefined;
  const scope = Object.freeze([...keyScope]), scopeKey = JSON.stringify(scope);
  const captured = items.map(source => ({ source, facts: displayMetadata.get(source), identity: metadataIdentity(source) }));
  for (const { source, facts, identity } of captured) {
    if (!facts || displayIdentity.get(source) !== identity || facts.scopeKey !== JSON.stringify(source.keyScope ?? [])) return undefined;
    if (source.keyScope?.length) { if (facts.scopeKey !== scopeKey) return undefined; }
    else if (!("domain" in source) || (source.domain !== "live" && source.domain !== "receipt")) return undefined;
    if (facts.receipt && (!("domain" in source) || source.domain !== "receipt" || source.terminalPresence !== facts.receipt
      || source.scope !== facts.receipt.scope || source.attemptId !== facts.receipt.attemptId)) return undefined;
  }
  const result = captured.map(({ source, facts }) => {
    if (source.keyScope?.length) return source;
    const copy = Object.freeze({ ...source, keyScope: scope });
    // Check association with the scope field removed, before issuing the clone.
    if (metadataIdentity({ ...copy, keyScope: source.keyScope }) !== metadataIdentity(source)) throw new Error("Changed Work association");
    issueDisplayMetadata(copy, Object.freeze({ ...facts!, scopeKey }));
    return copy;
  });
  if (captured.some(({ source, identity }) => identity !== metadataIdentity(source))) return undefined;
  return Object.freeze(result);
}

/** Only facts issued by this normalizer for this exact scoped source object. */
export function workDisplayMetadata(item: ProjectedSavedItem): WorkDisplayMetadata | undefined {
  const facts = displayMetadata.get(item.source);
  if (item.classification !== canonicalItemCase(item.source)) return undefined;
  if (!facts || displayIdentity.get(item.source) !== metadataIdentity(item.source) || facts.scopeKey !== JSON.stringify(item.source.keyScope ?? [])) return undefined;
  if (facts.receipt && (!("domain" in item.source) || item.source.domain !== "receipt"
    || item.source.terminalPresence !== facts.receipt || item.source.scope !== facts.receipt.scope || item.source.attemptId !== facts.receipt.attemptId)) return undefined;
  return facts;
}

export interface SavedItemIdentity {
  readonly classificationCase?: CanonicalCaseId;
  readonly keyScope?: readonly string[];
  readonly nodeId: string;
  readonly identityDomain?: "node" | "spill";
  /** Authoritative node-local identity; never a window/array index. */
  readonly itemIdentity: string;
  /** Content authorization version, not automatically part of the DOM key. */
  readonly revision?: string;
  /** Existing window revision, never an invented item revision. */
  readonly windowRevision?: string | number;
}

export interface LiveWorkIdentity {
  readonly domain: "live" | "receipt";
  readonly terminalPresence?: TerminalPresence;
  readonly namespace?: "work" | "handoff";
  readonly classificationCase?: CanonicalCaseId;
  readonly keyScope?: readonly string[];
  readonly scope: string;
  readonly recordId: string;
  readonly attemptId?: string;
  readonly turnId?: string;
  readonly nodeId?: never;
  readonly itemIdentity?: never;
  readonly revision?: never;
  readonly windowRevision?: never;
  readonly identityDomain?: never;
}
export type NormalizedSavedItem = (SavedItemIdentity | LiveWorkIdentity) & (
  | { readonly kind: "text"; readonly text: string; readonly textComplete?: boolean }
  | { readonly kind: "tool"; readonly executionId?: string; readonly executionIds?: readonly string[]; readonly callId?: string; readonly compressed?: boolean; readonly detailUnavailable?: boolean }
  // Hidden reasoning deliberately has no text field.
  | { readonly kind: "reasoning" }
  | { readonly kind: "reasoning_unavailable" }
  | { readonly kind: "unavailable"; readonly reason?: HistoryItemsUnavailableReason }
  | { readonly kind: "unknown" }
  | { readonly kind: "user" | "summary"; readonly text: string; readonly textComplete?: boolean }
  | { readonly kind: "ordinaryEmpty" }
  | { readonly kind: "record" | "interruption" }
);

export interface ProjectedSavedItem {
  /** Stable authoritative node/item identity; revision proof is separate. */
  readonly key: string;
  readonly source: NormalizedSavedItem;
  readonly canonicalKey?: string;
  readonly classification?: CanonicalCase;
  readonly toolIdentity?: "execution" | "call" | "unresolved";
}
export interface ToolSummaryMembership {
  /** Chrome identity only; changes cannot reparent members. */
  readonly anchorKey: string;
  readonly memberKeys: readonly string[];
  readonly executionIds: readonly string[];
  readonly continuationBefore?: "unknown" | "closed";
  readonly continuationAfter?: "unknown" | "closed";
}
export interface SavedItemProjection {
  readonly items: readonly ProjectedSavedItem[];
  readonly toolSummaries: readonly ToolSummaryMembership[];
  /** Unknown content facts remain Work members; this list is not a run boundary. */
  readonly workGroups?: readonly WorkGroup[];
  readonly sequence?: readonly ConversationSequence[];
  readonly partitionUnknownKeys: readonly string[];
}

export interface WorkGroup extends ToolSummaryMembership {
  readonly key: string;
  readonly firstMemberKey: string;
  readonly toolItemKeys: readonly string[];
  readonly unknownToolCount: number;
  readonly interrupted: boolean;
  readonly categoryCounts?: Readonly<Record<WorkCategory, number>>;
}
export type ConversationSequence = { readonly kind: "conversation"; readonly itemKey: string } | { readonly kind: "work"; readonly groupKey: string };
export function classifyConversationItem(item: NormalizedSavedItem): "conversation" | "work" {
  return canonicalItemCase(item).classification;
}
/** Authoritative ordered facts only. Live callers may append explicitly scoped tail facts. */
export function projectSavedItems(input: readonly NormalizedSavedItem[]) {
  return projectSavedItemsCore(input);
}

function projectSavedItemsCore(rawInput: readonly NormalizedSavedItem[], decodedLegacy = false): SavedItemProjection & { readonly workGroups: readonly WorkGroup[]; readonly sequence: readonly ConversationSequence[] } {
  const input = normalizeConversationFacts(rawInput);
  const items: ProjectedSavedItem[] = [];
  const groups: WorkGroup[] = [];
  const sequence: ConversationSequence[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  const associationById = new Map<string, string>();
  const conflicts = new Set<string>();
  const association = (item: NormalizedSavedItem) => {
    if (canonicalItemCase(item).toolPolicy !== "explicit-association" || item.kind !== "tool") return undefined;
    const scope = item.keyScope;
    if (!scope?.length || scope.some(value => !value)) return undefined;
    const ids = [...new Set(item.executionIds ?? (item.executionId ? [item.executionId] : []))].sort();
    if (ids.length) return { key: JSON.stringify(["tool", scope, "execution", ids]), ids, scope, type: "execution" as const };
    if (item.callId) return { key: JSON.stringify(["tool", scope, "call", item.callId]), ids: [], scope, type: "call" as const };
    return undefined;
  };
  for (const source of input) {
    const a = association(source);
    if (!a) continue;
    for (const id of [...(a.ids.length ? a.ids : [a.key]), ...(source.kind === "tool" && source.callId ? [JSON.stringify(["call", source.callId])] : [])]) {
      const scoped = JSON.stringify([a.scope, id]);
      const prior = associationById.get(scoped);
      if (prior && prior !== a.key) { conflicts.add(prior); conflicts.add(a.key); }
      associationById.set(scoped, a.key);
    }
  }
  const selectedTools = new Map<string, number>();
  let members: string[] = [], toolKeys: string[] = [], ids: string[] = [];
  let unknownTools = 0, interrupted = false;
  let categoryCounts: Record<WorkCategory, number> = { Tools: 0, Reasoning: 0, Notifications: 0, Problems: 0 };
  let before: "unknown" | "closed" = "unknown";
  const flush = (after: "unknown" | "closed") => {
    if (members.length) {
      const key = JSON.stringify(["work", toolKeys[0] ?? members[0]]);
      groups.push(Object.freeze({ key, firstMemberKey: members[0]!, anchorKey: members[0]!, memberKeys: Object.freeze(members), executionIds: Object.freeze(ids), toolItemKeys: Object.freeze(toolKeys), unknownToolCount: unknownTools, interrupted, categoryCounts: Object.freeze(categoryCounts), continuationBefore: before, continuationAfter: after }));
      sequence.push(Object.freeze({ kind: "work", groupKey: key }));
    }
    members = []; toolKeys = []; ids = []; unknownTools = 0; interrupted = false; categoryCounts = { Tools: 0, Reasoning: 0, Notifications: 0, Problems: 0 };
  };
  for (const source of input) {
    if (!("domain" in source) && (!source.nodeId || !source.itemIdentity || (!decodedLegacy && source.revision === undefined && source.windowRevision === undefined && !(source.identityDomain === "node" && source.kind === "unknown" && source.itemIdentity === source.nodeId)))) throw new Error("Missing authoritative identity/proof");
    if ("domain" in source && (!source.scope || !source.recordId)) throw new Error("Missing live record identity");
    const canonicalKey = "domain" in source ? JSON.stringify([source.domain, source.namespace ?? "work", source.scope, source.recordId]) : source.identityDomain === "spill" ? JSON.stringify(["spill", source.nodeId, source.itemIdentity]) : source.identityDomain === "node" ? JSON.stringify(["node", source.nodeId]) : JSON.stringify([source.nodeId, source.itemIdentity]);
    const a = association(source);
    const proven = a && !conflicts.has(a.key) ? a : undefined;
    const key = canonicalItemCase(source).keyPolicy === "association" && proven ? proven.key : canonicalKey;
    if (seen.has(canonicalKey)) throw new Error("Duplicate normalized saved item identity");
    seen.add(canonicalKey);
    if (proven && selectedTools.has(key)) {
      const index = selectedTools.get(key)!;
      const previous = items[index]!;
      if (previous.source.kind === "tool" && source.kind === "tool" && source.compressed) {
        const merged = Object.freeze({ ...previous.source, compressed: true });
        preserveDisplayMetadata(previous.source, merged);
        items[index] = Object.freeze({ ...previous, source: merged });
      }
      continue;
    }
    if (proven) selectedTools.set(key, items.length);
    const identity = "domain" in source ? { domain: source.domain, ...(source.terminalPresence ? { terminalPresence: source.terminalPresence } : {}), namespace: source.namespace ?? "work", scope: source.scope, recordId: source.recordId, ...(source.attemptId !== undefined ? { attemptId: source.attemptId } : {}), ...(source.turnId !== undefined ? { turnId: source.turnId } : {}) } : { ...(source.identityDomain ? { identityDomain: source.identityDomain } : {}), nodeId: source.nodeId, itemIdentity: source.itemIdentity, ...(source.revision !== undefined ? { revision: source.revision } : {}), ...(source.windowRevision !== undefined ? { windowRevision: source.windowRevision } : {}) };
    const scopedIdentity = { ...identity, classificationCase: canonicalItemCase(source).id, ...(source.keyScope ? { keyScope: Object.freeze([...source.keyScope]) } : {}) };
    let copy: NormalizedSavedItem;
    if (source.kind === "tool") {
      if (source.executionId !== undefined && !source.executionId) throw new Error("Empty execution identity");
      const raw = source.executionIds ?? (source.executionId ? [source.executionId] : []);
      if (raw.some(id => !id)) throw new Error("Empty execution identity");
      const fresh = [...new Set(raw)];
      if (canonicalItemCase(source).toolPolicy === "explicit-association") {
        ids.push(...fresh); toolKeys.push(key);
        if (!proven) unknownTools++;
      }
      copy = { ...scopedIdentity, kind: "tool", executionIds: Object.freeze(a ? [...new Set(raw)] : fresh), ...(source.callId ? { callId: source.callId } : {}), ...(source.compressed ? { compressed: true } : {}), ...(source.detailUnavailable ? { detailUnavailable: true } : {}), ...(source.executionId ? { executionId: source.executionId } : {}) };
    } else if (source.kind === "text") copy = { ...scopedIdentity, kind: "text", text: source.text, ...(source.textComplete !== undefined ? { textComplete: source.textComplete } : {}) };
    else if (source.kind === "user" || source.kind === "summary") copy = { ...scopedIdentity, kind: source.kind, text: source.text, ...(source.textComplete !== undefined ? { textComplete: source.textComplete } : {}) };
    else copy = { ...scopedIdentity, kind: source.kind, ...(source.kind === "unavailable" && source.reason ? { reason: source.reason } : {}) } as NormalizedSavedItem;
    preserveDisplayMetadata(source, copy);
    if (classifyConversationItem(source) === "conversation") {
      flush("closed"); before = "closed";
      sequence.push(Object.freeze({ kind: "conversation", itemKey: key }));
    } else {
      members.push(key);
      const category = canonicalItemCase(source).headingCategory;
      if (category) categoryCounts[category]++;
      interrupted ||= source.kind === "interruption";
      if (source.kind === "unknown" || source.kind === "unavailable") unknown.push(key);
    }
    items.push(Object.freeze({ key, canonicalKey, classification: canonicalItemCase(source), ...(source.kind === "tool" ? { toolIdentity: proven?.type ?? "unresolved" } : {}), source: Object.freeze(copy) }));
  }
  flush("unknown");
  return Object.freeze({ items: Object.freeze(items), toolSummaries: Object.freeze(groups), workGroups: Object.freeze(groups), sequence: Object.freeze(sequence), partitionUnknownKeys: Object.freeze(unknown) });
}

export interface ProjectedHistoryNode {
  readonly nodeId: string;
  readonly ordinal?: number;
  /** Ordinary retained node, not a fabricated content item. */
  readonly node: Readonly<HistoryItem>;
  readonly state: "items" | "legacy" | "deferred";
  readonly emptyOrdinary: boolean;
  readonly reason?: HistoryItemsUnavailableReason;
}
export interface HistoryWindowItemProjection {
  readonly projection: SavedItemProjection;
  readonly nodes: readonly ProjectedHistoryNode[];
  readonly retryFrom?: { readonly ordinal: number; readonly expect_node_id: string };
}

/** Internal specification vocabulary, NOT a narrower public wire enum. */
type MatrixNodeKind = "user" | "assistant_response" | "assistant" | "tool_result" | "spill" | "summary"
  | "reasoning" | "reasoning_unavailable" | "event" | "context" | "context_note"
  | "model_stream_observation" | "observation" | "message" | "notification"
  | "interruption_details" | "interruption_context" | "incomplete_response" | "interrupted_wait"
  | "unavailable" | "unknown";
const NODE_CASES = {
  user: "human", assistant_response: "assistantText", assistant: "assistantText", tool_result: "toolResult", spill: "spill", summary: "summary",
  reasoning: "reasoningMarker", reasoning_unavailable: "reasoningMarker", event: "event", context: "context", context_note: "context", model_stream_observation: "observation", observation: "observation", message: "notification", notification: "notification",
  interruption_details: "interruptionDetails", interruption_context: "interruptionContext", incomplete_response: "incompleteResponse", interrupted_wait: "interruptedWait", unavailable: "unavailable", unknown: "unknown",
} as const satisfies Record<MatrixNodeKind, CanonicalCaseId>;
const ASSISTANT_CASES = { text: "assistantText", tool_call: "toolCall", tool_result: "toolResult", reasoning_unavailable: "reasoningMarker", unavailable: "unavailable" } as const satisfies Record<HistorySavedItem["kind"], CanonicalCaseId>;
/** One decision; every presentation column is a value of the returned case. */
export function classifySavedHistoryCase(nodeKind: string | undefined, itemKind: HistorySavedItem["kind"] | "empty" | "legacy" | "deferred", hasActualReason = false, senderKind?: string): CanonicalCase {
  const id = nodeKind && Object.hasOwn(NODE_CASES, nodeKind) ? NODE_CASES[nodeKind as MatrixNodeKind] : "unknown";
  if (hasActualReason || itemKind === "unavailable") return CANONICAL_CASES.unavailable;
  if (itemKind === "deferred") return CANONICAL_CASES.unknown;
  if (id === "human") {
    if (itemKind === "empty") return CANONICAL_CASES.ordinaryEmpty;
    if (itemKind !== "text" && itemKind !== "legacy") return CANONICAL_CASES.unknown;
    return senderKind === "model" || senderKind === "thread" ? CANONICAL_CASES.receivedModel : senderKind === "external_cli" ? CANONICAL_CASES.receivedCli : senderKind === "human" ? CANONICAL_CASES.human : CANONICAL_CASES.receivedUnknown;
  }
  if (id === "assistantText") return CANONICAL_CASES[itemKind === "empty" ? "ordinaryEmpty" : itemKind === "legacy" ? "legacyUnknown" : ASSISTANT_CASES[itemKind]];
  return CANONICAL_CASES[id];
}
const NORMALIZED_CASES = { text: "assistantText", user: "receivedUnknown", summary: "summary", ordinaryEmpty: "ordinaryEmpty", tool: "toolCall", reasoning: "readableReasoning", reasoning_unavailable: "reasoningMarker", record: "unknown", unknown: "unknown", interruption: "interruptionDetails", unavailable: "unavailable" } as const satisfies Record<NormalizedSavedItem["kind"], CanonicalCaseId>;
/** Sole normalization boundary for already-normalized direct/live inputs. */
export function normalizeConversationFacts(input: readonly NormalizedSavedItem[]): readonly NormalizedSavedItem[] {
  return Object.freeze(input.map(item => {
    const copy = Object.freeze({ ...item, classificationCase: item.classificationCase ?? NORMALIZED_CASES[item.kind] });
    canonicalItemCase(copy);
    preserveDisplayMetadata(item, copy);
    return copy;
  }));
}
/** Stored-column lookup only; missing case requires the input normalizer. */
export function canonicalItemCase(item: NormalizedSavedItem): CanonicalCase {
  if (!item.classificationCase) throw new Error("Normalize canonical case at the input boundary");
  const value = CANONICAL_CASES[item.classificationCase];
  if (value.normalizedKind !== item.kind && !(item.kind === "unknown" && value.id === "unknown")) throw new Error("Canonical case does not match normalized fact");
  return value;
}

/** Accept ONLY the strict-decoded v3 DTO; does not decode unknown JSON. */
export function projectHistoryWindowItems(input: { readonly keyScope?: readonly string[]; readonly revision: string | number; readonly nodes: readonly HistoryItem[] }): HistoryWindowItemProjection {
  return projectHistoryNodes(input);
}
function projectHistoryNodes(input: { readonly keyScope?: readonly string[]; readonly revision?: string | number; readonly nodes: readonly HistoryItem[]; readonly liveFacts?: readonly NormalizedSavedItem[] }, decodedLegacy = false): HistoryWindowItemProjection {
  const nodes: ProjectedHistoryNode[] = [];
  const segment: NormalizedSavedItem[] = [];
  let retryFrom: HistoryWindowItemProjection["retryFrom"];
  for (const node of input.nodes) {
    if (!node.node_id) throw new Error("Typed history node requires canonical node_id");
    const ordinal = node.selection?.ordinal;
    const state = node.items === undefined ? "legacy" : node.items === null ? "deferred" : "items";
    nodes.push(Object.freeze({ nodeId: node.node_id, ...(ordinal !== undefined ? { ordinal } : {}), node, state, emptyOrdinary: state === "items" && !node.items!.length && classifySavedHistoryCase(node.kind, "empty").normalizedKind === "ordinaryEmpty", ...(node.items_unavailable_reason ? { reason: node.items_unavailable_reason } : {}) }));
    if (node.kind === "spill" && node.spill_tools) {
      // Public spill-local IDs only. No payload/args hydration or original-node join.
      const metadata = node.spill_tools;
      const seenSources = new Set<string>();
      for (const tool of metadata.items) {
        const sourceKey = JSON.stringify([tool.call_id, tool.execution_id ?? null]);
        if (seenSources.has(sourceKey)) continue;
        seenSources.add(sourceKey);
        const value: NormalizedSavedItem = { nodeId: node.node_id, itemIdentity: sourceKey, identityDomain: "spill", ...(input.revision !== undefined ? { windowRevision: input.revision } : {}), ...(input.keyScope ? { keyScope: input.keyScope } : {}), classificationCase: "spill", kind: "tool", callId: tool.call_id, executionIds: tool.execution_id ? [tool.execution_id] : [], compressed: true, detailUnavailable: true };
        issueDisplayMetadata(value, Object.freeze({ scopeKey: JSON.stringify(value.keyScope ?? []), nodeKind: node.kind,
          shells: Object.freeze(associatedDisplayShells(node, tool.execution_id ? [tool.execution_id] : [])) }));
        segment.push(value);
      }
      if (metadata.status !== "known" || metadata.truncated || !metadata.items.length) {
        const value: NormalizedSavedItem = { nodeId: node.node_id, itemIdentity: node.node_id, identityDomain: "node", ...(input.revision !== undefined ? { windowRevision: input.revision } : {}), ...(input.keyScope ? { keyScope: input.keyScope } : {}), kind: "unavailable" };
        issueDisplayMetadata(value, Object.freeze({ scopeKey: JSON.stringify(value.keyScope ?? []), nodeKind: node.kind, shells: Object.freeze([]) }));
        segment.push(value);
      }
      continue;
    }
    const normalize = (caseValue: CanonicalCase, rawIdentity: SavedItemIdentity, item?: HistorySavedItem): NormalizedSavedItem => {
      const value = normalizeValue(caseValue, rawIdentity, item);
      const ids = value.kind === "tool" ? value.executionIds ?? [] : [];
      if (ids.length > 64) return value;
      const shells = associatedDisplayShells(node, ids);
      const extension = item && (item.kind === "tool_call" || item.kind === "tool_result") && item.descriptor && item.detail_availability
        ? { descriptor: Object.freeze({ ...item.descriptor }), detailAvailability: item.detail_availability } : {};
      const notification = issueNotification(node.provenance?.notification);
      issueDisplayMetadata(value, Object.freeze({ ...extension, ...(notification ? { notification } : {}), scopeKey: JSON.stringify(value.keyScope ?? []),
        ...(node.kind ? { nodeKind: node.kind } : {}), ...(node.provenance?.created_at ? { createdAt: node.provenance.created_at } : {}), shells: Object.freeze(shells) }));
      return value;
    };
    const normalizeValue = (caseValue: CanonicalCase, rawIdentity: SavedItemIdentity, item?: HistorySavedItem): NormalizedSavedItem => {
      const kind = caseValue.normalizedKind;
      const identity = { ...rawIdentity, classificationCase: caseValue.id };
      switch (kind) {
        case "text": return { ...identity, kind, text: item?.kind === "text" ? item.text : "", ...(item?.kind === "text" ? { textComplete: item.text_complete } : {}) };
        case "user": case "summary": return { ...identity, kind, text: item?.kind === "text" ? item.text : kind === "user" ? node.excerpt ?? "" : "", ...(item?.kind === "text" ? { textComplete: item.text_complete } : {}) };
        case "tool": return { ...identity, kind, executionIds: item?.kind === "tool_call" || item?.kind === "tool_result" ? item.execution_ids : (node.executions ?? []).map(execution => execution.execution_id) };
        case "unavailable": return { ...identity, kind, ...(item?.kind === "unavailable" ? { reason: item.reason } : node.items_unavailable_reason ? { reason: node.items_unavailable_reason } : {}) };
        case "reasoning": return { ...identity, kind };
        case "reasoning_unavailable": return { ...identity, kind };
        case "ordinaryEmpty": return { ...identity, kind };
        case "record": case "interruption": return { ...identity, kind };
        default: { const unreachable: never = kind; return unreachable; }
      }
    };
    const nodeIdentity: SavedItemIdentity = { nodeId: node.node_id, itemIdentity: node.node_id, identityDomain: "node", ...(input.revision !== undefined ? { windowRevision: input.revision } : {}), ...(input.keyScope ? { keyScope: input.keyScope } : {}) };
    if (!node.items) {
      segment.push(normalize(classifySavedHistoryCase(node.kind, node.items === null ? "deferred" : "legacy", !!node.items_unavailable_reason, node.provenance?.sender?.kind), nodeIdentity));
      if (!retryFrom && node.items_unavailable_reason === "response_budget" && ordinal !== undefined) retryFrom = Object.freeze({ ordinal, expect_node_id: node.node_id });
      continue;
    }
    if (!node.items.length) segment.push(normalize(classifySavedHistoryCase(node.kind, "empty"), nodeIdentity));
    for (const item of node.items) {
      const identity: SavedItemIdentity = { ...(input.keyScope ? { keyScope: input.keyScope } : {}), nodeId: node.node_id, itemIdentity: item.item_identity, windowRevision: input.revision };
      segment.push(normalize(classifySavedHistoryCase(node.kind, item.kind, false, node.provenance?.sender?.kind), identity, item));
    }
  }
  for (const live of input.liveFacts ?? []) {
    if (!("domain" in live) || (live.domain !== "live" && live.domain !== "receipt")) throw new Error("Legacy liveFacts requires explicit live or receipt domain");
    segment.push(live);
  }
  const projection = projectSavedItemsCore(segment, decodedLegacy);
  return Object.freeze({ projection, nodes: Object.freeze(nodes), ...(retryFrom ? { retryFrom } : {}) });
}


/** Explicit live namespace: no saved node/item/ordinal or excerpt inference. */
export function normalizeLiveWorkFacts(input: { readonly scope: string; readonly items: readonly WorkItem[] }): readonly NormalizedSavedItem[] {
  return normalizeConversationFacts(input.items.filter(item => item.kind !== "pending_message" && !(item.kind === "message" && ["accepted", "held"].includes(item.state))).map(item => {
    if (!input.scope || !item.id || item.thread_id !== input.scope) throw new Error("Invalid live work scope");
    const identity = { domain: "live" as const, scope: input.scope, recordId: item.id, ...(typeof item.attempt_id === "string" ? { attemptId: item.attempt_id } : {}), ...(typeof item.turn_id === "string" ? { turnId: item.turn_id } : {}) };
    const value = Object.freeze(item.kind === "shell" && item.execution_id ? { ...identity, kind: "tool" as const, executionIds: Object.freeze([item.execution_id]) } : { ...identity, kind: "record" as const });
    issueDisplayMetadata(value, Object.freeze({ scopeKey: "[]", nodeKind: item.kind, publicState: item.state, shells: Object.freeze([]) }));
    return value;
  }));
}

const TERMINAL_PHASE_CASES = { pending: "terminalPending", reading: "terminalReading", settled: "terminalSettled" } as const satisfies Record<TerminalPresence["phase"], CanonicalCaseId>;
/** Only the same accepted reference's qualified S facts; omission means no extra row. */
export function normalizeTerminalPresenceFacts(presences: readonly TerminalPresence[]): readonly NormalizedSavedItem[] {
  return normalizeConversationFacts(presences.map(presence => {
    if (!presence.scope || !presence.attemptId || presence.receipt.scope !== presence.scope || presence.receipt.attemptId !== presence.attemptId) throw new Error("Mismatched terminal receipt scope");
    const value = { domain: "receipt" as const, scope: presence.scope, recordId: presence.attemptId, attemptId: presence.attemptId, terminalPresence: presence, kind: "record" as const, classificationCase: TERMINAL_PHASE_CASES[presence.phase] };
    issueDisplayMetadata(value, Object.freeze({ scopeKey: "[]", shells: Object.freeze([]), receipt: presence }));
    return value;
  }));
}
