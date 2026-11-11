import type {OwnSendPath,OwnSendPlacement} from "../../../ui-core/src/own-send-region";
import { workElementDisplay, workExecutionDisplay, type WorkElementDisplay } from "../../../ui-core/src/work-element-display";
import { WorkElementRow, formatWorkElementDisplay } from "../system/components/WorkElementRow";
import { ownSendPresentation } from "../../../ui-core/src/own-send-presentation";
import type { ThreadHandle } from "../../../data/src/store";
import { Disclosure } from "../system/components/Disclosure";
import type { HandoffRecord } from "../../../data/src/handoff";
import { senderFact } from "../../../data/src/sender";
import { CANONICAL_CASES, scopeIssuedWorkFacts, type CanonicalCase, normalizeConversationFacts, projectLegacyHistoryItems, projectHistoryWindowItems, projectSavedItems, normalizeLiveWorkFacts, normalizeTerminalPresenceFacts, type NormalizedSavedItem } from "../../../ui-core/src/conversation-items";
import type { HistoryItem } from "../../../data/src/protocol";
import { Markdown } from "../system/components/Message";
import type { WindowAcceptedSnapshot } from "../../../ui-core/src/window";
import type { ComponentChildren } from "preact";
import type { SavedItemProjection } from "../../../ui-core/src/conversation-items";
import { ConversationItems, type ConversationItem, type ConversationToolSummary, type ConversationWorkGroup } from "./ConversationItems";
import { characterAssets } from "../system/character-assets";
import { effect } from "@preact/signals-core";
import { MonitorPopover } from "../system/components/MonitorPopover";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { collectExecutionSteps, toolLabel, activityLabel, renderOutput, formatClock, formatDuration, formatRoute, formatTokens, parseTime, statusLabel, type AppModel, type ConversationRow, type StepRow as Step } from "../../../ui-core/src";
import { ScrollIntent } from "./scrollIntent";
import { WindowedScroll } from "./WindowedScroll";
import { BranchMark, Button, Composer, LoadingRows, EmptyState, Icon, KeyValue, LogBlock, Message, Notice, QuestionCard, StatusMark, StepRow, SummaryStrip, WorkSheet } from "../system/components";

/** Internal immutable publication seam; deliberately not a Core transport type. */
export interface ConversationSnapshot {
  readonly projection: SavedItemProjection;
  readonly revision: string;
  readonly readiness: "pending" | "ready";
}
export interface ConversationSnapshotReader<T extends ConversationSnapshot> {
  readonly current: T;
  subscribe(listener: (value: T) => void): () => void;
  isCurrent(value: T): boolean;
}

/** Render only the adapter's accepted reference, never a staged candidate. */
export function SnapshotConversation<T extends ConversationSnapshot>({ reader, renderItem, renderHeading }: {
  reader: ConversationSnapshotReader<T>;
  renderItem: (item: ConversationItem) => ComponentChildren;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}) {
  const [view, setView] = useState(() => ({ reader, value: reader.current }));
  useLayoutEffect(() => {
    const accept = (value: T) => { if (reader.isCurrent(value)) setView({ reader, value }); };
    const unsubscribe = reader.subscribe(accept);
    accept(reader.current);
    return unsubscribe;
  }, [reader]);
  const snapshot = view.reader === reader ? view.value : reader.current;
  return <section class="snapshot-conversation" data-accepted-revision={snapshot.revision} data-readiness={snapshot.readiness}>
    <ConversationItems {...snapshot.projection} renderItem={renderItem} renderHeading={renderHeading} />
  </section>;
}

/** The caller supplies an approved/internal normalized producer, never aggregate-text inference here. */
export function AcceptedWindowConversation({ reader, project, renderItem, renderHeading }: {
  reader: { peek(): WindowAcceptedSnapshot; subscribe(listener: (value: WindowAcceptedSnapshot) => void): () => void; isCurrent(value: WindowAcceptedSnapshot): boolean };
  project: (snapshot: WindowAcceptedSnapshot) => SavedItemProjection;
  renderItem: (item: ConversationItem) => ComponentChildren;
  renderHeading?: (summary: ConversationToolSummary) => ComponentChildren;
}) {
  const [view, setView] = useState(() => ({ reader, value: reader.peek() }));
  useLayoutEffect(() => {
    const accept = (value: WindowAcceptedSnapshot) => { if (reader.isCurrent(value)) setView({ reader, value }); };
    const unsubscribe = reader.subscribe(accept);
    accept(reader.peek());
    return unsubscribe;
  }, [reader]);
  const snapshot = view.reader === reader ? view.value : reader.peek();
  return <section class="snapshot-conversation" data-accepted-revision={snapshot.revision}
    data-accepted-generation={snapshot.generation} data-readiness={snapshot.pending ? "pending" : "ready"}>
    <ConversationItems {...project(snapshot)} renderItem={renderItem} renderHeading={renderHeading} />
  </section>;
}

/** Console presentation for an already authorized projection, independent of wire decoding. */
export function SavedConversationItems({ model, projection, renderBefore, trailing, nodes,localRegion }: { model: AppModel; projection: SavedItemProjection & { sequence?: readonly ({kind: "conversation"; itemKey: string} | {kind: "work"; groupKey: string})[]; workGroups?: readonly ConversationWorkGroup[] }; nodes?: readonly HistoryItem[]; renderBefore?: (item: ConversationItem) => ComponentChildren; trailing?: ComponentChildren;localRegion?:{placement:OwnSendPlacement;content:ComponentChildren} }) {
  const t = model.t.value;
  const savedSteps = collectExecutionSteps(nodes ?? [], model.shells.value);
  const savedExecutionIds = new Set(savedSteps.map(step => step.executionId));
  const allSteps = [...savedSteps, ...model.conversation.value.flatMap(row => row.type === "steps" ? row.steps : []).filter(step => !savedExecutionIds.has(step.executionId))];
  const [openRecords, setOpenRecords] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [openMemberships, setOpenMemberships] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const membershipKey = (summary: { key?: string; memberKeys: readonly string[] }) => summary.key ?? JSON.stringify(summary.memberKeys);
  const memberships = new Set((projection.workGroups ?? projection.toolSummaries).map(membershipKey));
  useLayoutEffect(() => {
    const records = new Set(projection.items.filter(item => item.source.kind === "record").map(item => item.key));
    setOpenRecords(previous => {
      const kept = new Map([...previous].filter(([key]) => records.has(key)));
      return kept.size === previous.size ? previous : kept;
    });
    setOpenMemberships(previous => {
      const kept = new Map([...previous].filter(([key]) => memberships.has(key)));
      return kept.size === previous.size ? previous : kept;
    });
  }, [projection]);
  const opened = (summary: { memberKeys: readonly string[] }) => openMemberships.get(membershipKey(summary)) ?? projection.items.filter(item=>summary.memberKeys.includes(item.key)).some(item=>item.classification!.openPolicy !== "closed");
  const hidden = (item: ConversationItem) => {
    const summary = (projection.workGroups ?? projection.toolSummaries).find(summary => summary.memberKeys.includes(item.key));
    return summary !== undefined && !opened(summary);
  };
  const renderWorkGroup = (group: ConversationWorkGroup, children: ComponentChildren) => {
    const steps = allSteps.filter(step => group.executionIds.includes(step.executionId));
    const active = steps.some(step => step.status === "running");
    const failures = steps.filter(step => step.state === "failed" || step.status === "failed" || step.status === "recovery" || (typeof step.exitCode === "number" && step.exitCode !== 0)).length;
    const unknown = group.unknownToolCount > 0 || steps.length !== group.executionIds.length;
    const completed = group.executionIds.length > 0 && !unknown && steps.every(step => step.status === "completed");
    const status = active ? "running" : failures ? "failed" : completed ? "completed" : undefined;
    const reasons = [...new Set(projection.items.filter(item => group.memberKeys.includes(item.key)).flatMap(item => item.source.kind === "unavailable" && item.source.reason ? [item.source.reason] : []))];
    const label = [...(["Tools","Reasoning","Notifications","Problems"] as const).flatMap(category=>{
      const n=group.categoryCounts?.[category] ?? 0;
      if(!n)return [];
      const title=category==="Tools"?t("tools.count",{n}):t(`work.category.${category}`,{n});
      return [title+(category==="Tools"&&failures?` (${t("work.failedCount",{n:failures})})`:"")];
    }), ...(active?[t("status.running")]:[])].join(" · ");
    return <Disclosure class="step step-group" open={opened(group)} data-work-group={group.key} data-key={group.key} data-heading-anchor-key={group.firstMemberKey} data-heading-member-keys={JSON.stringify(group.memberKeys)} onToggle={event => {
      const open = event.currentTarget.open;
      setOpenMemberships(previous => {
        const next = new Map([...previous].filter(([key]) => memberships.has(key)));
        next.set(membershipKey(group), open);
        return next;
      });
    }}><summary data-work-heading=""><Icon name="layers" /><span class="tool-group-label">{label}</span>{status ? <StatusMark status={status} label={statusLabel(t, status)} /> : null}<span class="meta" /></summary><div class="step-group-list">{children}</div></Disclosure>;
  };
  const workRow = (item: ConversationItem) => {
    const bundle=workElementDisplay(item);
    if(!bundle)return <div data-work-display-unavailable="">{t("work.textUnavailable")}</div>;
    const display=formatWorkElementDisplay(bundle);
    if(bundle.detailPolicy!=="none"&&bundle.detailPolicy!=="unavailable")return null;
    return <WorkElementRow display={display} anchorKey={item.key} detailPolicy={bundle.detailPolicy}/>;
  };
  return <ConversationItems {...projection} localRegion={localRegion} renderWorkGroup={projection.workGroups ? renderWorkGroup : undefined} renderBefore={renderBefore} trailing={trailing} isItemHidden={hidden} renderHeading={summary => {
    const steps = allSteps.filter(step => summary.executionIds.includes(step.executionId));
    const active = steps.find(step => step.status === "running");
    const nonzero = steps.filter(step => typeof step.exitCode === "number" && step.exitCode !== 0).length;
    const failed = steps.some(step => step.state === "failed" || step.status === "recovery" || (typeof step.exitCode === "number" && step.exitCode !== 0));
    const members = projection.items.filter(item => summary.memberKeys.includes(item.key));
    const missingExecution = members.some(item => item.source.kind !== "tool" || !(item.source.executionIds?.length || item.source.executionId)) || steps.length !== summary.executionIds.length;
    const status = active ? "running" : failed ? "failed" : summary.executionIds.length > 0 && !missingExecution ? "completed" : undefined;
    const label = [t("tools.count", { n: summary.memberKeys.length }), ...(missingExecution ? [t("work.textUnavailable")] : []), ...((summary.continuationBefore !== "closed" || summary.continuationAfter !== "closed") ? [t("work.partial")] : []), ...(nonzero ? [t("tools.nonzero", { n: nonzero })] : []), ...(active ? [t("tools.active", { command: toolLabel(active.description, active.command) })] : [])].join(" · ");
    return <section class="steps"><StepRow group open={opened(summary)} command={label} status={status ? <StatusMark status={status} label={statusLabel(t, status)} /> : <span class="muted caption">{t("work.textUnavailable")}</span>} onToggle={open => {
      setOpenMemberships(previous => {
        const next = new Map([...previous].filter(([key]) => memberships.has(key)));
        next.set(membershipKey(summary), open);
        return next;
      });
    }}>{null}</StepRow></section>;
  }}
    renderItem={item => {
      if (item.source.kind === "text" || item.source.kind === "user" || item.source.kind === "summary") {
        const node = item.source.nodeId ? nodes?.find(node => node.node_id === item.source.nodeId) : undefined;
        if (!node && "domain" in item.source) {
          const source = item.source;
          const handle = model.handle.value;
          const record = source.namespace === "handoff" ? handle?.handoff.value.find(record => record.key === source.recordId) : undefined;
          return <div data-live-overlay=""><Message bot who={t("convo.shellboy")} at={t("convo.live")} text={item.source.text ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
            {record ? <LiveRecordChrome model={model} record={record} retry={() => handle?.retryHandoff()} /> : null}
          </Message></div>;
        }
        if (!node) return <Markdown text={item.source.text ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} />;
        const fact = senderFact(node.provenance?.sender);
        const speaker: Extract<ConversationRow, { type: "message" }>["speaker"] = node.kind === "assistant_response" ? { kind: "shellboy" }
          : fact.kind === "human" ? { kind: "you" } : fact.kind === "model" ? fact
          : fact.kind === "external_cli" ? (fact.label?.trim() ? { kind: "other", label: `CLI: ${fact.label}` } : { kind: "cli" })
          : { kind: "unknown", model: fact.kind === "unknown_model", label: fact.label };
        return <><ProjectedMessage model={model} authorizedText={item.source.text ?? ""} row={{ type: "message", id: node.node_id!, speaker, text: item.source.text ?? "", truncated: false, at: node.provenance?.created_at }} />{(item.source.kind === "text" || item.source.kind === "user" || item.source.kind === "summary") && item.source.textComplete === false ? <div class="caption muted" data-item-partial="">{t("work.partial")}</div> : null}</>;
      }
      if (item.source.kind === "tool") {
        const ids = item.source.executionIds ?? (item.source.executionId ? [item.source.executionId] : []);
        const steps = allSteps;
        const source = item.source;
        const badge = source.compressed ? <span class="caption muted" data-tool-compressed="">{t("work.compressed")}</span> : null;
        return <div data-tool-call-id={source.callId} data-tool-detail-unavailable={source.detailUnavailable ? "true" : undefined}>{badge}{!ids.length ? <div class="caption muted" data-execution-unavailable="">{workRow(item)}</div> : ids.map(id => {
          const step = steps.find(step => step.executionId === id);
          const display=workExecutionDisplay(item,id);
          return <div key={id} data-execution-id={id}>{hidden(item) ? null : step && display ? <StepView model={model} step={step} display={display} openPolicy={item.classification!.openPolicy} /> : <div class="caption muted" data-execution-unresolved="">{workRow(item)}</div>}</div>;
        })}</div>;
      }
      if (item.source.kind === "ordinaryEmpty") return <div class="caption muted" data-empty-ordinary="">{t("work.textUnavailable")}</div>;
      if (item.source.kind === "reasoning" || item.source.kind === "reasoning_unavailable") return <div data-thinking-marker="">{workRow(item)}</div>;
      if (item.source.kind === "interruption") return workRow(item);
      if ("terminalPresence" in item.source && item.source.terminalPresence) {
        const presence=item.source.terminalPresence;
        return <div data-terminal-presence="" data-terminal-phase={presence.phase} data-client-reason={presence.reason}>{workRow(item)}</div>;
      }
      if (item.source.kind === "record") return <div data-internal-records="">{workRow(item)}</div>;
      if (item.source.kind === "unknown" || item.source.kind === "unavailable") {
        const source=item.source,handle=model.handle.value;
        const record="domain" in source&&source.namespace==="handoff"?handle?.handoff.value.find(record=>record.key===source.recordId):undefined;
        return <><div data-item-unavailable="" data-items-unavailable-reason={source.kind==="unavailable"?source.reason:undefined}>{workRow(item)}</div>{record?<LiveRecordChrome model={model} record={record} retry={()=>handle?.retryHandoff()}/>:null}</>;
      }
      return null;
    }} />;
}

/** A typed deferred node is a placeholder, not authority to show its aggregate. */
export function DeferredHistoryNode({ model, row }: { model: AppModel; row: HistoryItem }) {
  return <div class="caption muted" data-node={row.node_id} data-items-unavailable-reason={row.items_unavailable_reason}>
    {model.t.value("work.textUnavailable")}
  </div>;
}

function HandoffRetryControl({model}: {model:AppModel}) {
  const handle=model.handle.value;
  const state=handle?.handoffRetryState.value;
  if(!handle||!state||state.phase==="idle")return null;
  return <span data-handoff-retry-phase={state.phase}>
    <span class="caption muted">{model.t.value(state.phase==="reading"?"convo.handoffConfirming":`convo.retry.${state.reason}`)}</span>
    {state.phase==="reading"||state.canRetry?<Button variant="link" disabled={!state.canRetry} onClick={()=>void handle.retryHandoff()}>{model.t.value("action.retry")}</Button>:null}
  </span>;
}

export function LiveRecordChrome({ model, record }: { model: AppModel; record: HandoffRecord; retry: () => void }) {
  const t=model.t.value;
  const incomplete = record.incomplete || record.status === "failed";
  return <div data-live-record-chrome={record.key}>
    {incomplete ? <div class="caption muted" data-live-incomplete="">{t("convo.liveIncomplete")}</div> : null}
    <HandoffRetryControl model={model}/>
    {record.status === "failed" && !model.handle.value?.handoffRetryState.value ? <div class="caption muted">{t("convo.handoffFailed")}</div> : null}
  </div>;
}

/** Only records read from the current owned ledger may enter this adapter. */
export function projectOwnedHandoffFacts(scope: string, records: readonly HandoffRecord[]): readonly NormalizedSavedItem[] {
  return normalizeConversationFacts(records.map(record => record.nodeId === undefined && record.proof === undefined && record.transferred !== true && record.status !== "ready" && record.text
    ? {domain: "live", namespace: "handoff", scope, recordId: record.key, attemptId: record.attemptId, kind: "text", text: record.text}
    : {domain: "live", namespace: "handoff", scope, recordId: record.key, attemptId: record.attemptId, kind: "unknown"}));
}

export function retainUnretiredLiveFacts(snapshot: WindowAcceptedSnapshot, scope: string, current: boolean, facts: readonly NormalizedSavedItem[]): readonly NormalizedSavedItem[] {
  if (!current) return facts;
  facts = facts.filter(fact => !("domain" in fact && fact.attemptId && snapshot.terminalPersistedAttempts?.some(proof => proof.scope === scope && proof.attemptId === fact.attemptId)));
  return facts.filter(fact => !("domain" in fact && fact.attemptId && fact.turnId && snapshot.retiredAttempts?.some(retired => retired.scope === scope && retired.revision === snapshot.revision && retired.attemptId === fact.attemptId && retired.turnId === fact.turnId)));
}

function OwnSendContent<Ref>({model,projection,nodes,scope,acceptedRef,current,isCurrent,trailing,path,hiddenItemKeys=new Set<string>()}:{model:AppModel;projection:SavedItemProjection;nodes?:readonly HistoryItem[];scope:string;acceptedRef:Ref|undefined;current:boolean;isCurrent:()=>boolean;trailing?:ComponentChildren;path?:OwnSendPath;hiddenItemKeys?:ReadonlySet<string>}) {
  const rows=model.ownMutationRows(scope);
  const decision=useMemo(()=>ownSendPresentation({ref:acceptedRef,current,scope,projection,localRows:rows,hiddenItemKeys,canonicalRows:nodes,path,nodeOrdinals:new Map((nodes??[]).flatMap(node=>node.node_id&&node.selection?.ordinal!==undefined?[[node.node_id,node.selection.ordinal] as const]:[])),reservation:model.ownSendReservation() as import("../../../ui-core/src/own-send-region").OwnSendReservation<Ref>|undefined,validateCurrent:isCurrent,cohortVersion:{accepted:model.acceptedOwnMessages.peek(),pending:model.pendingOwnMessage.peek()}}),[acceptedRef,current,scope,projection,model.acceptedOwnMessages.value,model.pendingOwnMessage.value]);
  useLayoutEffect(()=>{model.installOwnPresentation(decision,isCurrent);},[decision]);
  const local=<div data-own-presentation="" data-own-placement={decision.placement.kind} data-own-order-conflict={decision.conflictIds.length?decision.conflictIds.join(","):undefined}>{decision.localRows.length&&decision.placement.kind==="unqualified"?<div role="status" data-own-placement-reason={decision.placement.reason}>{model.t.value("composer.pending.placementUnqualified")}: {decision.placement.reason}</div>:null}{decision.conflictIds.length?<div role="status" class="caption muted" data-own-order-problem="">{model.t.value("composer.pending.orderConflict")} {decision.conflictIds.join(", ")}</div>:null}{decision.localRows.map(message=><aside key={message.operationId} data-pending-own-message={message.operationId} data-pending-phase={message.phase}>
    <Message bot={false} who={model.t.value("convo.you")} text={message.text} at={model.t.value(`composer.pending.${message.phase}`)} copyLabel={model.t.value("code.copy")} copiedLabel={model.t.value("code.copied")}/>
    {message.phase==="failed"||message.phase==="unconfirmed"?<Button variant="link" onClick={()=>void model.resend()}>{model.t.value("action.retry")}</Button>:null}
  </aside>)}</div>;
  return <SavedConversationItems model={model} projection={decision.projection} nodes={current?nodes:[]} localRegion={{placement:decision.placement,content:local}} trailing={trailing}/>;
}

function LegacySavedContent({model,handle}: {model:AppModel;handle:ThreadHandle;history:ReturnType<ThreadHandle["history"]["peek"]>|undefined;rows:readonly ConversationRow[];boundary:number|undefined;follow:()=>void}) {
  const owner=model.legacyPresentation.value;
  const [accepted,setAccepted]=useState(()=>({owner,ref:owner?.acceptedView.peek()}));
  useLayoutEffect(()=>{
    if(!owner)return;
    const update=(ref:ReturnType<typeof owner.acceptedView.peek>)=>{if(owner.isCurrent(ref))setAccepted({owner,ref});};
    const stop=owner.acceptedView.subscribe(update);update(owner.acceptedView.peek());return stop;
  },[owner]);
  const ref=accepted.owner===owner?accepted.ref:owner?.acceptedView.peek();
  if(!owner||!ref||!owner.isCurrent(ref))return <OwnSendContent model={model} projection={projectSavedItems([])} scope={model.ownMutationScope()} acceptedRef={ref} current={false} isCurrent={()=>false}/>;
  const receipts=[...ref.terminalPersistedAttempts,...ref.structuralTerminalReceipts];
  const retired=(attemptId:string|null|undefined)=>!!attemptId&&receipts.some(proof=>proof.scope===ref.scope&&proof.attemptId===attemptId);
  const live=ref.live.filter(record=>!retired(record.attemptId));
  const handoffs=model.data.capabilities.value.includes("live.text") ? projectOwnedHandoffFacts(handle.threadId,live) : [];
  const work=normalizeLiveWorkFacts({scope:handle.threadId,items:(ref.work.value?.items??[]).filter(item=>!retired(item.attempt_id))});
  const projection=projectLegacyHistoryItems({nodes:ref.rows,keyScope:[ref.scope],liveFacts:[...handoffs,...work,...normalizeTerminalPresenceFacts(ref.terminalPresence ?? [])]}).projection;
  return <OwnSendContent model={model} nodes={ref.rows} projection={projection} scope={model.ownMutationScope()} acceptedRef={ref} current={true} isCurrent={()=>owner.isCurrent(ref)} path={{tail:handle.history.value.loaded&&!handle.history.value.loading&&!handle.history.value.stale&&!handle.history.value.error,empty:ref.rows.length===0,lastNodeId:ref.rows.at(-1)?.node_id,lastOrdinal:ref.rows.at(-1)?.selection?.ordinal}}/>;
}

export function SavedWindowContent({ model, snapshot, live, liveBoundary, liveFacts }: { model: AppModel; snapshot: WindowAcceptedSnapshot; live?: ComponentChildren; liveBoundary?: number; liveFacts?: readonly NormalizedSavedItem[] }) {
  if (snapshot.revision === undefined) return null;
  const handle = model.handle.value;
  const keyScope = handle ? [handle.handoffScope()] : undefined;
  const mapped = projectHistoryWindowItems({ revision: snapshot.revision, nodes: snapshot.rows, keyScope });
  const records = liveFacts ?? (handle ? normalizeLiveWorkFacts({scope: handle.threadId, items: handle.work.value.value?.items ?? []}) : []);
  const handoffs = handle ? projectOwnedHandoffFacts(handle.threadId, handle.handoff.value).map(fact => {
    if (!("domain" in fact)) return fact;
    const original = handle.handoff.value.find(record => record.key === fact.recordId);
    return original?.readyAttempt ? {...fact, turnId: original.readyAttempt.turnId} : fact;
  }) : [];
  const scope = handle?.handoffScope() ?? "";
  const current = model.longReader.value?.acceptedView.isCurrent(snapshot) ?? false;
  const retained = retainUnretiredLiveFacts(snapshot, scope, current, [...handoffs, ...records]);
  const retainedHandoffs = retained.filter(fact => handoffs.includes(fact) || ("domain" in fact && (fact.namespace === "handoff" || fact.kind === "text")));
  const retainedRecords = retained.filter(fact => records.includes(fact) && !("domain" in fact && (fact.namespace === "handoff" || fact.kind === "text")));
  const pendingNodes = new Set(current ? snapshot.attemptPresentations?.filter(fact => fact.scope === scope && fact.state === "pending" && !snapshot.terminalPersistedAttempts?.some(proof => proof.scope === scope && proof.attemptId === fact.attemptId) && retained.some(source => "domain" in source && source.attemptId === fact.attemptId && (source.turnId === fact.turnId || (source.namespace === "handoff" && source.turnId === undefined))) && !snapshot.retiredAttempts?.some(retired => retired.scope === scope && retired.revision === snapshot.revision && retired.attemptId === fact.attemptId && retired.turnId === fact.turnId)).flatMap(fact => fact.nodeIds) : []);
  const saved = mapped.projection.items.filter(item => !item.source.nodeId || !pendingNodes.has(item.source.nodeId)).map(item => item.source);
  // This is the captured history cut, not an ordinal assigned to a live record.
  const cut = liveBoundary === undefined ? -1 : saved.findIndex(source => {
    const node = snapshot.rows.find(node => node.node_id === source.nodeId);
    return node?.selection?.ordinal !== undefined && node.selection.ordinal >= liveBoundary;
  });
  const ordered = cut < 0 ? [...saved, ...retainedHandoffs] : [...saved.slice(0, cut), ...retainedHandoffs, ...saved.slice(cut)];
  const issuedWork=[...retainedRecords,...normalizeTerminalPresenceFacts(current ? snapshot.terminalPresence ?? [] : [])];
  const scopedWork=keyScope?scopeIssuedWorkFacts(issuedWork,keyScope):issuedWork;
  const workScopeRejected=scopedWork===undefined;
  // Rejection is an unavailable Work cut, never a successful empty publication.
  const projection = workScopeRejected ? projectSavedItems(ordered) : projectSavedItems([...ordered,...scopedWork]);
  // Live text without item-kind proof cannot unlock or replace saved Conversation text.
  return <OwnSendContent model={model} projection={projection} nodes={snapshot.rows} scope={model.ownMutationScope()} acceptedRef={snapshot} current={current} isCurrent={()=>model.longReader.peek()?.acceptedView.isCurrent(snapshot)??false} path={{tail:!snapshot.pending&&!snapshot.disposed&&(snapshot.total===0||snapshot.range?.last===snapshot.total-1),empty:snapshot.total===0,revision:snapshot.revision,lastNodeId:snapshot.rows.at(-1)?.node_id,lastOrdinal:snapshot.rows.at(-1)?.selection?.ordinal}} hiddenItemKeys={new Set(projection.items.filter(item=>pendingNodes.has(item.source.nodeId??"")&&item.source.kind!=="user").map(item=>item.key))} trailing={<>{workScopeRejected&&current?<div key="work-scope-rejected" role="status" data-work-scope-rejected="" data-state-source="client" data-state-value="scope-qualification-rejected">CLIENT: {model.t.value("work.textUnavailable")} (scope-qualification-rejected)</div>:null}{handle?.handoffOverflow.value ? <div class="caption muted" data-live-overflow="">{model.t.value("convo.handoffLimit")} <HandoffRetryControl model={model}/></div> : undefined}</>} />;
}

const stepDuration = (s: Step, now: number): string | undefined => {
  if (s.durationMs !== undefined) return formatDuration(s.durationMs);
  const start = parseTime(s.startedAt);
  return s.status === "running" && start !== undefined ? formatDuration(now - start) : undefined;
};

const exitText = (s: Step): string | undefined => (typeof s.exitCode === "number" ? `exit ${s.exitCode}` : undefined);

export function statusCharacter(status: string): string {
  switch (status) {
    case "awaiting": return "ask";
    case "recovery": case "failed": return "error";
    case "completed": return "complete-check";
    case "stopped": case "idle": return "rest";
    case "running": case "waiting": return "thinking";
    default: return "neutral";
  }
}

export function ConversationStatus({ model }: { model: AppModel }) {
  const t = model.t.value;
  const work = model.work.value;
  const row = model.selectedRow.value;
  const status = model.threadReplies.value.some((r) => r.recipient.kind === "human") ? "awaiting" : row?.status;
  const running = work.running[0];
  const start = running?.startedAt ? parseTime(running.startedAt) : undefined;
  return <div key="conversation-status" class="work-row conversation-status" role="status">{status ? <><img class="character-status" src={characterAssets[statusCharacter(status)]} alt="" /><span>{status === "running" && row?.summary.activity ? activityLabel(model.lang.value, row.summary.activity) : statusLabel(t, status)}</span>
    {running ? <span>{running.label} {work.running.length > 1 ? t("work.runningCount", { n: work.running.length }) : ""} {start === undefined ? "" : formatDuration(model.now.value - start)}</span> : null}
    {status === "recovery" ? <><span>{model.recovery.value?.message ?? model.recovery.value?.hint}</span>{model.canRetry.value ? <Button onClick={() => void model.retry()}>{t("action.retry")}</Button> : null}</> : null}
  </> : " "}</div>;
}

export function Output({ model, id, command, complete, boxed }: { model: AppModel; id: string; command: string; complete: boolean; boxed?: boolean }) {
  const [raw, setRaw] = useState(false);
  const t = model.t.value;
  const out = model.outputs.value.get(id);
  if (!out || (out.loading && out.text === "")) return <div class="log muted">{t("details.outputLoading")}</div>;
  if (out.error) return <div class="log muted">{t("details.outputError", { message: out.error })}</div>;
  const rendered = renderOutput({ command, text: out.text, complete: complete && !out.loading && !out.cutOff });
  return (
    <>
      <Button onClick={() => { void navigator.clipboard.writeText(rendered && !raw ? rendered.lines.map((line) => line.text).join("\n") : out.text).catch(() => {}); }}>{t("code.copy")}</Button>
      {rendered ? <Button onClick={() => setRaw(!raw)}>{raw ? t("output.formatted") : t("output.raw")}</Button> : null}
      {rendered && !raw ? <pre class={boxed ? "log boxed" : "log"} tabIndex={0}>{rendered.lines.map((line, i) => <span key={i} class={`output-${line.kind}`}>{line.text}{i < rendered.lines.length - 1 ? "\n" : ""}</span>)}</pre> : <LogBlock text={out.text === "" ? t("details.outputEmpty") : out.text} boxed={boxed ?? false} />}
      {out.cutOff ? <div class="caption muted">{t("details.outputMore")}</div> : null}
    </>
  );
}

export function StepView({ model, step, display, openPolicy = CANONICAL_CASES.toolCall.openPolicy }: { model: AppModel; step: Step; display: WorkElementDisplay; openPolicy?: CanonicalCase["openPolicy"] }) {
  const t = model.t.value;
  const choice = model.toolStepChoices.value.get(step.executionId);
  const open = choice ?? (openPolicy !== "closed");
  useEffect(() => {
    if (!open || (display.detailPolicy!=="actual-safe-typed"&&display.detailPolicy!=="existing-shell-output")) return;
    model.selectedStepId.value = step.executionId;
    return model.watchOutput(step.executionId);
  }, [model, open, step.executionId, display.detailPolicy]);
  const formatted=formatWorkElementDisplay(display);
  const shellDisplay=model.shells.value.has(step.executionId)?{...formatted,typeIcon:"term" as const}:formatted;
  if(display.detailPolicy!=="actual-safe-typed"&&display.detailPolicy!=="existing-shell-output")return <WorkElementRow display={shellDisplay} anchorKey={step.executionId} detailPolicy={display.detailPolicy}/>;
  return <WorkElementRow display={shellDisplay} anchorKey={step.executionId} detailPolicy={display.detailPolicy} open={open} onToggle={next=>{
    if(next!==open)model.toolStepChoices.value=new Map(model.toolStepChoices.peek()).set(step.executionId,next);
  }}>
    {step.description ? <div class="mono muted caption">{step.command}</div> : null}
    <Output model={model} id={step.executionId} command={step.command ?? ""} complete={step.status === "completed" || step.status === "failed"}/>
  </WorkElementRow>;
}

function ProjectedMessage({ model, row, authorizedText }: { model: AppModel; row: Extract<ConversationRow, {type:"message"}>; authorizedText: string }) {
  const t = model.t.value;
  const threadId = model.handle.value?.threadId;
  const point = threadId !== undefined ? formatRoute({ view: "branches", threadId, nodeId: row.id }) : undefined;
  const found = model.rowMarks.value.get(row.id);
  const mark = found && threadId !== undefined ? <BranchMark href={formatRoute({ view: "branches", threadId, nodeId: found.nodeId })} label={found.branches === 1 ? t("branches.markOne") : t("branches.mark", { n: found.branches })} /> : null;
  const who = row.speaker.kind === "you" ? t("convo.you") : row.speaker.kind === "shellboy" ? t("convo.shellboy") : row.speaker.kind === "cli" ? t("convo.cli") : row.speaker.kind === "model" ? t("convo.modelSender") : row.speaker.kind === "unknown" ? t(row.speaker.model ? "convo.unknownModelSender" : "convo.unknownSender") : row.speaker.label;
  const body = model.bodies.value.get(row.id);
  return (
    <Message bot={row.speaker.kind === "shellboy"} who={who} at={formatClock(row.at)} text={authorizedText} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
      {row.speaker.kind === "model" ? <div class="caption sender-fact">
        {model.senderTitles.values.value.get(row.speaker.threadId)?.state === "ready" ? <div>{t("convo.senderCurrentTitle", { title: model.senderTitles.values.value.get(row.speaker.threadId)!.title ?? "" })}</div> : <div>{t("convo.senderTitleUnresolved")}</div>}
        <div>{t("convo.senderThread")} <a href={formatRoute({ view: "conversation", threadId: row.speaker.threadId })}><code class="sender-id">{row.speaker.threadId}</code></a></div>
        {row.speaker.label !== undefined ? <div>{t("convo.senderClaimedLabel", { label: row.speaker.label })}</div> : null}
      </div> : row.speaker.kind === "unknown" && row.speaker.label !== undefined ? <div class="caption">{t("convo.senderClaimedLabel", { label: row.speaker.label })}</div> : null}
      {row.truncated && body?.text === undefined ? (
        <span class="more">
          <Button variant="link" disabled={body?.loading} onClick={() => void model.loadBody(row.id)}>
            {body?.loading ? t("convo.loadingBody") : t("convo.fullMessage")}
          </Button>
          {body?.error ? <span class="muted caption">{body.error}</span> : null}
        </span>
      ) : null}
      <div class="msg-acts">
        {mark}
        {point ? <a class="quiet" href={point}>{t("branches.fromHere")}</a> : null}
      </div>
    </Message>
  );
}

function WorkRegions({ model, place }: { model: AppModel; place: string }) {
  const t = model.t.value;
  const work = model.work.value;
  const replies = model.threadReplies.value;
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const state = (s: string) => s === "accepted" ? t("work.accepted") : s === "held" ? t("work.held") : s === "starting" ? t("work.starting") : s === "stopping" ? t("work.stopping") : t("work.runningState");
  return <>
    {replies.length ? <section class="work-region"><h3>{t("work.replies")}</h3>{replies.map((r) => r.recipient.kind === "human" ?
      <QuestionCard key={r.id} id={`${place}-${r.id}`} label={t("work.replies")} waitingWord={t("status.awaiting")} question={r.question} answerLabel={t("inbox.answer")} submitLabel={t("inbox.answerResume")} error={error} onAnswer={(text) => { void model.answerReply(r.id, text).then((failure) => setError(failure ? t("inbox.answerFailed", { message: failure }) : undefined)); }} /> :
      <div class="work-row" key={r.id}><span>{r.question}</span><span>{r.state}</span>{r.recipient.kind === "thread" ? <a href={formatRoute({ view: "conversation", threadId: r.recipient.threadId })}>{r.recipient.title}</a> : null}</div>)}</section> : null}
    {work.running.length ? <section class="work-region running-region"><h3>{t("work.running")}</h3><span class="caption muted">{t("work.incomplete")}</span>{work.running.map((r) => <div class="work-row" key={r.id}><MonitorPopover className="running-label" label={r.label} preview><span>{r.label}</span>{r.command ? <code>{r.command}</code> : null}<span>{r.startedAt && parseTime(r.startedAt) !== undefined ? formatDuration(model.now.value - parseTime(r.startedAt)!) : ""}</span></MonitorPopover><span>{state(r.state)} {r.startedAt && parseTime(r.startedAt) !== undefined ? formatDuration(model.now.value - parseTime(r.startedAt)!) : ""}</span></div>)}</section> : null}
    {work.pending.length ? <section class="work-region"><h3>{t("work.pending")}</h3>{work.pending.map((r) => <div class="work-row" key={r.id}><span>{r.label || t("work.textUnavailable")}</span><span class="mono">{r.id}</span><span>{state(r.state)}</span><Button disabled={busy !== undefined || model.connection.value !== "connected" || model.uncertainCancels.value.has(r.id)} onClick={() => { setBusy(r.id); void model.cancelPending(r.id).then((failure) => { setBusy(undefined); setError(failure ? t("work.cancelFailed", { message: failure }) : undefined); }); }}>{t("work.cancel")}</Button></div>)}{error ? <div role="alert">{error}</div> : null}</section> : null}
    {work.partial ? <div class="caption muted">{t("work.partial")}</div> : null}
    {model.handle.value?.work.value.stale && (work.running.length > 0 || work.pending.length > 0) ? <div class="caption muted">{t("work.stale")}</div> : null}
  </>;
}

function Details({ model }: { model: AppModel }) {
  const t = model.t.value;
  const step = model.selectedStep.value;
  const usage = model.usage.value;
  const details = model.details.value;
  const started = formatClock(step?.startedAt, true);
  const measured = (m: { value: number; partial: boolean } | undefined) => (m ? formatTokens(m.value) : undefined);
  const usageRows = usage
    ? [
        { key: t("usage.input"), value: measured(usage.input), mono: true },
        { key: t("usage.output"), value: measured(usage.output), mono: true },
        { key: t("usage.cached"), value: usage.cachedPercent !== undefined ? `${usage.cachedPercent}%` : measured(usage.cached), mono: true },
        { key: t("usage.attempts"), value: usage.attempts, mono: true },
      ].filter((r) => r.value !== undefined)
    : [];
  return (
    <aside class="details" aria-label={t("details.title")}>
      <WorkRegions model={model} place="sidebar" />
      {step ? (
        <section class="detail-region"><h3>{t("details.title")}</h3>
          <div class="cmd"><Icon name="term" /><span>{step.command}</span></div>
          <KeyValue
            rows={[
              ...(step.status ? [{ key: t("details.status"), value: <StatusMark status={step.status} label={statusLabel(t, step.status)} /> }] : []),
              ...(stepDuration(step, model.now.value) ? [{ key: t("details.duration"), value: stepDuration(step, model.now.value), mono: true }] : []),
              ...(typeof step.exitCode === "number" ? [{ key: t("details.exit"), value: step.exitCode, mono: true }] : []),
              ...(started ? [{ key: t("details.started"), value: started, mono: true }] : []),
              ...(step.cwd ? [{ key: t("details.directory"), value: step.cwd, mono: true }] : []),
            ]}
          />
          <Output model={model} id={step.executionId} command={step.command ?? ""} complete={step.status === "completed" || step.status === "failed"} boxed />
      {usageRows.length > 0 ? (
        <>
          <h3>{t("usage.title")}</h3>
          <KeyValue rows={usageRows} />
          {usage?.partial ? <div class="muted caption">{t("usage.partial")}</div> : null}
        </>
      ) : null}
      {details ? (
        <>
          <h3>{t("details.thread")}</h3>
          <KeyValue
            rows={[
              { key: t("details.model"), value: details.model, mono: true },
            ]}
          />
        </>
      ) : null}
        </section>
      ) : <section class="detail-region"><h3>{t("details.title")}</h3><p class="muted">{t("details.choose")}</p></section>}
    </aside>
  );
}

function OrderedHistory({ model, handle, rows, win, history, scroller, pinned, follow, loading, t }: { model: AppModel; handle: NonNullable<AppModel["handle"]["value"]>; rows: AppModel["conversation"]["value"]; win: AppModel["longReader"]["value"]; history: NonNullable<AppModel["handle"]["value"]>["history"]["value"] | undefined; scroller: import("preact").RefObject<HTMLDivElement>; pinned: { current: ScrollIntent }; follow: (from?: Element | null) => void; loading: boolean; t: AppModel["t"]["value"] }) {
  const [boundary, setBoundary] = useState<{ attempt: string; ordinal: number; legacy: number } | undefined>();
  useEffect(() => {
    if (!handle) return;
    let attempt: string | undefined;
    return effect(() => {
      const next = handle.handoff.value[0]?.attemptId;
      if (next === attempt) return;
      attempt = next;
      setBoundary(next === undefined ? undefined : { attempt: next, ordinal: win?.total ?? 0, legacy: rows.length });
    });
  }, [handle, win]);
  const owned = new Set(handle.handoff.value.filter(r => r.nodeId !== undefined).map(r => r.nodeId));
  const visible = (row: ConversationRow): boolean => row.type !== "message" || (!owned.has(row.id) && !owned.has(row.id.replace(/:commentary$/, "")));
  return <>
        {win ? (
          <WindowedScroll
            model={model}
            win={win}
            live={null}
            renderRow={() => <></>}
            renderAcceptedView={snapshot => <><SavedWindowContent model={model} snapshot={snapshot} liveBoundary={boundary?.ordinal} /></>}

            liveBoundary={boundary?.ordinal}
          />
        ) : (
          <div
            class="scroll"
            ref={scroller}
            onWheel={(e) => pinned.current.wheel(e.deltaY)}
            onTouchStart={(e) => { if (e.touches[0]) pinned.current.touchStart(e.touches[0].clientY); }}
            onTouchMove={(e) => { if (e.touches[0]) pinned.current.touchMove(e.touches[0].clientY); }}
            onKeyDown={(e) => pinned.current.key(e.key)}
            onScroll={(e) => { pinned.current.scroll(e.currentTarget); }}
          >
            {history?.earlierHidden ? (
              <span class="more">
                {handle.canShowEarlier() ? (
                  <Button disabled={history.loadingMore} onClick={() => { model.senderPageAfter(() => handle.loadOlderHistory()); }}>{t("convo.earlier")}</Button>
                ) : (
                  <span class="muted caption">{t("convo.earlierLimit")}</span>
                )}
              </span>
            ) : null}
            {history?.error && !history.loaded ? (
              <Notice tone="bad" actions={<Button onClick={() => void handle.refresh()}>{t("convo.retryLoad")}</Button>}>
                {t("convo.loadError", { message: history.error.message })}
              </Notice>
            ) : null}
            <LegacySavedContent model={model} handle={handle} history={history} rows={rows} boundary={boundary?.legacy} follow={follow} />
            {[...model.rowMarks.value].map(([rowId, mark]) => <div class="scroll-mark" key={rowId}><BranchMark href={formatRoute({view:"branches",threadId:handle.threadId,nodeId:mark.nodeId})} label={mark.branches === 1 ? t("branches.markOne") : t("branches.mark",{n:mark.branches})} /></div>)}
            {rows.length === 0 && !history?.error ? (
              loading ? <LoadingRows label={t("convo.loading")} rows={5} /> : <EmptyState icon="chat" character title={t("convo.empty")} body={t("convo.emptyBody")} />
            ) : null}
          </div>
        )}
  </>;
}

export function Conversation({ model }: { model: AppModel }) {
  const t = model.t.value;
  const [sheetOpen, setSheetOpen] = useState(false);
  const handle = model.handle.value;
  const rows = model.conversation.value;
  const win = model.longReader.value;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(new ScrollIntent());
  const history = handle?.history.value;
  // The windowed reader owns every scroll write, including live-tail resizing.
  // The legacy reader finds its box from the live message when necessary.
  const follow = (from?: Element | null) => {
    if (win) { win.layoutChanged(); return; }
    const el = from?.closest<HTMLElement>(".scroll") ?? scroller.current;
    if (el && pinned.current.following) pinned.current.program(el, el.scrollHeight);
  };

  useLayoutEffect(() => { if (!win) follow(); }, [rows, win]);
  useEffect(() => {
    pinned.current = new ScrollIntent();
    setSheetOpen(false);
  }, [handle]);

  const send = model.sendState.value;
  const pendingOwn = model.pendingOwnMessage.value;
  const sendBlocked = model.ownSendBlocked();
  const capacityBlocked = model.ownSendCapacityReason.value || model.acceptedOwnMessages.value.length >= 8;
  const conn = model.connection.value;
  const recovery = model.recovery.value;
  const loading = !history?.loaded;

  return (
    <>
      <div class="convo">
        {handle ? <OrderedHistory model={model} handle={handle} rows={rows} win={win} history={history} scroller={scroller} pinned={pinned} follow={follow} loading={loading} t={t} /> :
          <EmptyState icon="chat" title={t("convo.noThread")} body={t("convo.noThreadBody")}>
            <Button variant="primary" onClick={() => void model.createThread()}>{t("action.new")}</Button>
          </EmptyState>}
        <ConversationStatus key="permanent-conversation-status" model={model} />
        {handle ? <div class="dock">
          {recovery ? (
            <Notice
              tone="bad"
              title={t("recovery.title")}
              actions={
                <Button variant="warn" onClick={() => void model.retry()}>
                  <Icon name="retry" small />
                  {t("action.retry")}
                </Button>
              }
            >
              <div>{recovery.message}</div>
              <div class="muted">{t("recovery.body")}</div>
            </Notice>
          ) : null}
          {send.kind === "failed" ? <Notice tone="bad">{t("composer.failed", { message: send.message })}</Notice> : null}
          {send.kind === "unconfirmed" ? (
            <Notice tone="wait" actions={<Button variant="warn" onClick={() => void model.resend()}>{t("composer.retry")}</Button>}>
              {t("composer.unconfirmed")}
            </Notice>
          ) : null}
          {(model.threadReplies.value.length || model.work.value.running.length || model.work.value.pending.length || model.work.value.partial) ? <div class="work-strip"><Button onClick={() => setSheetOpen(true)}>{[model.threadReplies.value.length ? `${t("work.replies")} ${model.threadReplies.value.length}` : "", model.work.value.running.length ? t("work.runningCount", { n: model.work.value.running.length }) : "", model.work.value.pending.length ? `${t("work.pending")} ${model.work.value.pending.length}` : ""].filter(Boolean).join(", ")}{model.work.value.partial ? ` ${t("work.partial")}` : ""}</Button></div> : null}
          <Composer
            label={t("composer.label")}
            placeholder={t("composer.placeholder")}
            hint={capacityBlocked ? t("composer.pending.capacity") : pendingOwn ? t(`composer.pending.${pendingOwn.phase}`) : t("composer.hint")}
            sendLabel={t("composer.send")}
            canSend={conn === "connected" && !sendBlocked}
            busy={send.kind === "sending"}
            draftScope={handle?.handoffScope()}
            onSend={(text,onReserved) => model.send(text,onReserved)}
            stop={
              model.canStop.value ? (
                <Button variant="stop" onClick={() => void model.stop()}>
                  <Icon name="square" small />
                  {t("composer.stop")}
                </Button>
              ) : undefined
            }
          />
        </div> : null}
      </div>
      {handle ? <Details model={model} /> : null}
      <WorkSheet open={sheetOpen} title={t("work.title")} closeLabel={t("work.close")} onClose={() => setSheetOpen(false)}><WorkRegions model={model} place="sheet" /></WorkSheet>
    </>
  );
}
