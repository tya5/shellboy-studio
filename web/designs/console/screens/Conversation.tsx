import { PanelPage } from "../system/components/PanelTabs/PanelPage";
import { External, FIRST_SETUP_GUIDE } from "./SetupParts";
import { tokenTotal } from "./usage-label";
import { ArtifactDetail, ArtifactList } from "./ArtifactPanel";
import { ATTACHMENT_RETENTION } from "../../../ui-core/src/attachment-section";
import { CAPABILITY_ARTIFACTS, CAPABILITY_ATTACHMENT_PAGE } from "../../../data/src";
import {messageRelationship} from "../../../ui-core/src/sender-display";
import { capturedWorkElementDisplay, capturedWorkExecutionDisplay, type WorkElementDisplay } from "../../../ui-core/src/work-element-display";
import { WorkElementRow, formatWorkElementDisplay } from "../system/components/WorkElementRow";
import { Disclosure } from "../system/components/Disclosure";
import type { HandoffRecord } from "../../../data/src/handoff";
import { speakerOf, speakerDisplay as projectSpeakerDisplay, type Speaker } from "../../../ui-core/src/conversation";
import { CANONICAL_CASES, scopeIssuedWorkFacts, type CanonicalCase, projectHistoryWindowItems, projectSavedItems, withPresentationContainers, normalizeLiveWorkFacts, projectOwnedHandoffFacts, workDisplayMetadata, type NormalizedSavedItem } from "../../../ui-core/src/conversation-items";
import type { HistoryItem, AttemptOutputLimit } from "../../../data/src/protocol";
import { Markdown } from "../system/components/Message";
import type { WindowAcceptedSnapshot } from "../../../ui-core/src/window";
import { projectionFromDisplayPlan, type ConversationDisplayPlan } from "../../../ui-core/src/conversation-display-plan";
import type { ComponentChildren } from "preact";
import type { SavedItemProjection } from "../../../ui-core/src/conversation-items";
import { ConversationItems, type ConversationItem, type ConversationToolSummary, type ConversationWorkGroup } from "./ConversationItems";
import { ConversationCharacter } from "../system/components";
import { computed, effect } from "@preact/signals-core";
import { memo } from "preact/compat";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { readRightPanelWidth, RIGHT_PANEL_WIDTH_MAX, RIGHT_PANEL_WIDTH_MIN, collectExecutionSteps, toolLabel, activityLabel, activityStatus, activityStatusLabel, statusLabel, renderOutput, formatClock, formatDuration, formatRoute, formatTokens, formatCount, errorMessage, parseTime, type AppModel, type ConversationRow, type StepRow as Step } from "../../../ui-core/src";
import { ThreadSettingsPanel, type SettingsDestination } from "./ThreadSettingsPanel";
import { WindowedScroll } from "./WindowedScroll";
import { BranchMark, Button, Composer, ContextRing, DataTable, Section, ModelPicker, LoadingRows, EmptyState, Icon, KeyValue, LayoutSeparator, ListDivider, ListRow, LogBlock, Message, Notice, PanelTabs, ShellFooter, ShellToggle, QuestionCard, StatusMark, StepRow, SummaryStrip, WorkSheet, OutputLimitNotice as OutputLimitNoticeRow } from "../system/components";

type OpenThreadSettings = (field: SettingsDestination["field"]) => void;

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
type AssistantTextMembership = "message" | "live-presence" | "empty-saved" | "content-unavailable";
function assistantTextMembership(item: ConversationItem): AssistantTextMembership {
  const source=item.source;
  if(source.kind!=="text"||typeof source.text!=="string")return "message";
  if(source.text.length > 0 && "domain" in source)return "live-presence";
  if(source.text.length === 0)return source.textComplete===true?"empty-saved":"content-unavailable";
  return "message";
}

function toolGroupStatus(steps: readonly Step[], completeCoverage: boolean) {
  if (steps.some(step => step.status === "running")) return "running";
  if (steps.some(step => step.status === "failed")) return "failed";
  if (steps.some(step => step.status === "stopped")) return "stopped";
  return completeCoverage && steps.length > 0 && steps.every(step => step.status === "completed") ? "completed" : undefined;
}

export function SavedConversationItems({ model, projection: suppliedProjection, displayPlan, renderBefore, trailing, nodes,localRegion, openThreadSettings }: { model: AppModel; projection: SavedItemProjection & { sequence?: readonly ({kind: "conversation"; itemKey: string} | {kind: "work"; groupKey: string})[]; workGroups?: readonly ConversationWorkGroup[] }; displayPlan?: ConversationDisplayPlan; nodes?: readonly HistoryItem[]; renderBefore?: (item: ConversationItem) => ComponentChildren; trailing?: ComponentChildren;localRegion?: { readonly kind: "unqualified"; readonly tailRows: readonly import("../../../ui-core/src/own-send-presentation").PositionedOwnSendRow[]; readonly renderRow: (row: import("../../../ui-core/src/model").PendingOwnMessage | Extract<import("../../../ui-core/src/own-send-presentation").PositionedOwnSendRow, { kind: "live" }>) => ComponentChildren }; openThreadSettings?: OpenThreadSettings }) {
  const projection = useMemo(() => displayPlan ? projectionFromDisplayPlan(displayPlan) : suppliedProjection, [displayPlan?.entries, displayPlan?.sequence, displayPlan?.workGroups, suppliedProjection]);
  const planEntries = displayPlan?.entries ?? [];
  const planByKey = useMemo(() => new Map(planEntries.map(entry => [entry.item.key, entry])), [displayPlan?.entries]);
  // Coverage describes the whole assistant/work cut, not authority for each independently
  // typed human item. Require an exact entry for every projected item, then gate bodies per entry.
  const planCurrent = !!displayPlan;
  const planItems = useMemo(() => planEntries.map(({ item, presentationContainer }) => ({ ...item, presentationContainer })), [displayPlan?.entries]);
  const ordinalByNode = useMemo(() => new Map(nodes?.flatMap(row => row.node_id && row.selection?.ordinal !== undefined ? [[row.node_id, row.selection.ordinal] as const] : [])), [nodes]);
  const membership = useMemo(() => new Map(projection.items.map(item => { const body = planByKey.get(item.key)?.body; return [item.key, !planCurrent || body?.kind === "unavailable" ? "content-unavailable" : assistantTextMembership(item)] as const; })), [projection.items, planByKey, planCurrent]);
  const t = model.t.value;
  const shells = model.shells.value;
  const savedSteps = useMemo(() => collectExecutionSteps(nodes ?? [], shells), [nodes, shells]);
  const savedExecutionIds = useMemo(() => new Set(savedSteps.map(step => step.executionId)), [savedSteps]);
  const liveSteps = useMemo(() => model.conversation.value.flatMap(row => row.type === "steps" ? row.steps : []).filter(step => !savedExecutionIds.has(step.executionId)), [model.conversation.value, savedExecutionIds]);
  const allSteps = useMemo(() => [...savedSteps, ...liveSteps], [savedSteps, liveSteps]);
  const [openRecords, setOpenRecords] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [openMemberships, setOpenMemberships] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const membershipKey = (summary: { key?: string; memberKeys: readonly string[] }) => summary.key ?? JSON.stringify(summary.memberKeys);
  const memberships = useMemo(() => new Set((projection.workGroups ?? projection.toolSummaries).map(membershipKey)), [projection]);
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
  const groupProjection = useMemo(() => {
    const groups = projection.workGroups ?? projection.toolSummaries;
    const groupForItem = new Map<string, (typeof groups)[number]>();
    const itemsByKey = new Map(projection.items.map(item => [item.key, item]));
    const itemsByGroup = new Map<string, ConversationItem[]>();
    for (const group of groups) {
      const key = membershipKey(group);
      const members = group.memberKeys.map(memberKey => itemsByKey.get(memberKey)).filter((item): item is ConversationItem => item !== undefined);
      itemsByGroup.set(key, members);
      for (const item of members) groupForItem.set(item.key, group);
    }
    const defaults = new Map(groups.map(group => [membershipKey(group), (itemsByGroup.get(membershipKey(group)) ?? []).some(item => item.classification?.openPolicy !== "closed")]));
    return { groupForItem, itemsByGroup, defaults };
  }, [projection]);
  const stepsByGroup = useMemo(() => {
    const groups = projection.workGroups ?? projection.toolSummaries;
    const stepsByExecution = new Map(allSteps.map(step => [step.executionId, step]));
    return new Map(groups.map(group => [membershipKey(group), group.executionIds.map(id => stepsByExecution.get(id)).filter((step): step is Step => step !== undefined)]));
  }, [projection, allSteps]);
  const opened = (summary: { memberKeys: readonly string[] }) => openMemberships.get(membershipKey(summary)) ?? groupProjection.defaults.get(membershipKey(summary)) ?? false;
  const hidden = (item: ConversationItem) => {
    const summary = groupProjection.groupForItem.get(item.key);
    return summary !== undefined && !opened(summary);
  };
  const groupOpen = useMemo(() => {
    const byKey = new Map(projection.items.map(item => [item.key, item]));
    return new Map(projection.workGroups?.map(group => [group.key, openMemberships.get(group.key) ?? group.memberKeys.some(key => byKey.get(key)?.classification?.openPolicy !== "closed")]));
  }, [projection, openMemberships]);
  const renderWorkGroup = (group: ConversationWorkGroup, children: ComponentChildren, window?: import("./ConversationItems").WindowedWorkGroup) => {
    const groupKey = membershipKey(group);
    const steps = stepsByGroup.get(groupKey) ?? [];
    const active = steps.some(step => step.status === "running");
    const failures = steps.filter(step => step.status === "failed").length;
    const unknown = group.unknownToolCount > 0 || steps.length !== group.executionIds.length;
    const status = toolGroupStatus(steps, !unknown);
    const stateLabel = status ? activityStatusLabel(t, status) : group.executionIds.length || group.unknownToolCount ? t("common.notReadable") : undefined;
    const reasons = [...new Set((groupProjection.itemsByGroup.get(groupKey) ?? []).flatMap(item => item.source.kind === "unavailable" && item.source.reason ? [item.source.reason] : []))];
    const categoryLabel = [...(["Tools","Reasoning","Notifications","Problems"] as const).flatMap(category=>{
      const n=group.categoryCounts?.[category] ?? 0;
      if(!n)return [];
      const title=category==="Tools"?t(n === 1 ? "tools.countOne" : "tools.count", { n }):t(`work.category.${category}`,{n});
      return [title+(category==="Tools"&&failures?` (${t("work.failedCount",{n:failures})})`:"")];
    }), ...(active?[t("status.running")]:[])].join(" · ");
    const actualMemberCount = group.memberKeys.length;
    const first = planByKey.get(group.firstMemberKey)?.item;
    const headingAnchor = window?.headingVisible && !groupOpen.get(group.key) ? first : undefined;
    const label = categoryLabel || (actualMemberCount ? String(actualMemberCount) : t("work.textUnavailable"));
    return <Disclosure class="step step-group" open={groupOpen.get(group.key) ?? opened(group)} data-windowed-work={window ? "" : undefined} data-work-group={group.key} data-key={group.key} data-heading-anchor-key={group.firstMemberKey} data-heading-member-keys={JSON.stringify(group.memberKeys)} onToggle={event => {
      const open = event.currentTarget.open;
      setOpenMemberships(previous => {
        const next = new Map([...previous].filter(([key]) => memberships.has(key)));
        next.set(membershipKey(group), open);
        return next;
      });
    }}><summary ref={window?.headingRef} hidden={window !== undefined && !window.headingVisible} data-viewport-key={window?.headingRef ? `heading:${group.key}` : undefined} data-windowed-heading={window ? "" : undefined} data-item-key={headingAnchor?.key} data-node={headingAnchor?.source.nodeId} data-work-heading="" aria-label={`${t("work.group")}: ${label}${stateLabel ? ` · ${stateLabel}` : ""}`}><Icon role="work.group" /><span class="tool-group-label">{label}</span>{status ? <StatusMark shell status={status} label={activityStatusLabel(t, status)} /> : stateLabel ? <span class="muted caption">{stateLabel}</span> : null}<span class="meta" /></summary><div class="step-group-list">{children}</div></Disclosure>;
  };
  const workRow = (item: ConversationItem) => {
    const bundle=capturedWorkElementDisplay(item, planByKey.get(item.key)?.work);
    if(!bundle)return <div data-work-display-unavailable="">{t("work.textUnavailable")}</div>;
    const display=formatWorkElementDisplay(bundle);
    if(bundle.detailPolicy!=="none"&&bundle.detailPolicy!=="unavailable")return null;
    return <WorkElementRow display={display} anchorKey={item.key} detailPolicy={bundle.detailPolicy}/>;
  };
  if (!planCurrent) return <section role="status" data-display-plan-unavailable="">{t("work.textUnavailable")}</section>;
  return <ConversationItems {...projection} ordinalByNode={ordinalByNode} groupOpen={groupOpen} items={planItems} sequence={displayPlan!.sequence} workGroups={displayPlan!.workGroups} isItemAbsent={item=>membership.get(item.key)==="empty-saved"} localRegion={localRegion} renderWorkGroup={renderWorkGroup} renderBefore={renderBefore} trailing={trailing} isItemHidden={hidden} renderHeading={summary => {
    const groupKey = membershipKey(summary);
    const steps = stepsByGroup.get(groupKey) ?? [];
    const active = steps.find(step => step.status === "running");
    const nonzero = steps.filter(step => typeof step.exitCode === "number" && step.exitCode !== 0).length;
    const members = groupProjection.itemsByGroup.get(groupKey) ?? [];
    const missingExecution = members.some(item => item.source.kind !== "tool" || !(item.source.executionIds?.length || item.source.executionId)) || steps.length !== summary.executionIds.length;
    const status = toolGroupStatus(steps, !missingExecution);
    const label = [t(summary.memberKeys.length === 1 ? "tools.countOne" : "tools.count", { n: summary.memberKeys.length }), ...(missingExecution ? [t("work.textUnavailable")] : []), ...((summary.continuationBefore !== "closed" || summary.continuationAfter !== "closed") ? [t("work.partial")] : []), ...(nonzero ? [t("tools.nonzero", { n: nonzero })] : []), ...(active ? [t("tools.active", { command: toolLabel(active.description, active.command) })] : [])].join(" · ");
    return <section class="steps"><StepRow group open={opened(summary)} command={label} status={status ? <StatusMark shell status={status} label={activityStatusLabel(t, status)} /> : <span class="muted caption">{t("work.textUnavailable")}</span>} onToggle={open => {
      setOpenMemberships(previous => {
        const next = new Map([...previous].filter(([key]) => memberships.has(key)));
        next.set(membershipKey(summary), open);
        return next;
      });
    }}>{null}</StepRow></section>;
  }}
    renderItem={item => {
      const displayEntry = planByKey.get(item.key);
      const displayText = item.source.kind === "text" && "domain" in item.source && item.source.namespace === "handoff" ? item.source.text : displayEntry?.body.kind === "preview" || displayEntry?.body.kind === "typed-canonical" || displayEntry?.body.kind === "typed-partial" ? displayEntry.body.text : undefined;
      const sharedNode = item.source.nodeId ? nodes?.find(node => node.node_id === item.source.nodeId) : undefined;
      if (item.source.kind === "text" || item.source.kind === "user" || item.source.kind === "summary") {
        const node = item.source.nodeId ? nodes?.find(node => node.node_id === item.source.nodeId) : undefined;
        if(membership.get(item.key)==="content-unavailable" && node)return <BodyReadMessage model={model} node={node} displayText={displayText} />;
        if (!node && "domain" in item.source) {
          const source = item.source;
          const handle = model.handle.value;
          const record = source.namespace === "handoff" ? handle?.handoff.value.find(record => record.key === source.recordId) : undefined;
          return <div data-live-overlay={assistantTextMembership(item)==="live-presence" ? "" : undefined}><Message bot who={t("convo.shellboy")} at={t("convo.live")} text={displayText ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} live={assistantTextMembership(item)==="live-presence" || displayEntry?.body.kind === "preview" || displayEntry?.body.kind === "typed-partial"}>
            {record ? <LiveRecordChrome model={model} record={record} /> : null}
          </Message></div>;
        }
        if (!node) return <Markdown text={displayText ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} live={!item.source.nodeId && item.source.kind === "text" && item.source.textComplete === false} />;
        const nodeAuthoritative = allProseNode(node);
        const firstProseItem = node.items?.find(item => item.kind === "text")?.item_identity;
        const body = nodeAuthoritative ? model.bodyState(node.node_id!) : undefined;
        if (nodeAuthoritative && body?.text !== undefined && item.source.kind === "text" && item.source.itemIdentity !== firstProseItem) return null;
        const speaker = speakerOf(node);
        const savedLimit = item.source.kind === "text" ? outputLimitNoticeFacts(undefined, workDisplayMetadata(item)?.outputLimit) : undefined;
        return <><ProjectedMessage model={model} relationship={messageRelationship(node.provenance?.message,node.node_id)} authorizedText={displayText ?? ""} bodyPartial={item.source.kind === "text" && item.source.textComplete === false} bodyUnavailable={!nodeAuthoritative && item.source.kind === "text" && item.source.textComplete === false} nodeAuthoritative={nodeAuthoritative} row={{ type: "message", id: node.node_id!, itemIdentity: nodeAuthoritative ? undefined : item.source.kind === "text" ? item.source.itemIdentity : undefined, speaker, text: displayText ?? "", truncated: false, at: node.provenance?.created_at }} />{savedLimit ? <OutputLimitNotice model={model} fact={savedLimit} openThreadSettings={openThreadSettings} /> : null}{(item.source.kind === "text" || item.source.kind === "user" || item.source.kind === "summary") && (displayEntry?.body.kind === "preview" || displayEntry?.body.kind === "typed-partial") && body?.text === undefined ? <div class="caption muted" data-item-partial="">{t("work.partial")}</div> : null}</>;
      }
      if (item.source.kind === "tool") {
        const ids = item.source.executionIds ?? (item.source.executionId ? [item.source.executionId] : []);
        const steps = allSteps;
        const source = item.source;
        const badge = source.compressed ? <span class="caption muted" data-tool-compressed="">{t("work.compressed")}</span> : null;
        return <div data-tool-call-id={source.callId} data-tool-detail-unavailable={source.detailUnavailable ? "true" : undefined}>{badge}{!ids.length ? <div class="caption muted" data-execution-unavailable="">{workRow(item)}</div> : ids.map(id => {
          const step = steps.find(step => step.executionId === id);
          const display=capturedWorkExecutionDisplay(item, planByKey.get(item.key)?.work,id);
          return <div key={id} data-execution-id={id}>{hidden(item) ? null : step && display ? <StepView model={model} step={step} display={display} openPolicy={item.classification!.openPolicy} /> : <div class="caption muted" data-execution-unresolved="">{workRow(item)}</div>}</div>;
        })}</div>;
      }
      if (item.source.kind === "ordinaryEmpty") { const savedLimit = outputLimitNoticeFacts(undefined, workDisplayMetadata(item)?.outputLimit); return savedLimit ? <OutputLimitNotice model={model} fact={savedLimit} openThreadSettings={openThreadSettings} /> : <div class="caption muted" data-empty-ordinary="">{t("work.textUnavailable")}</div>; }
      if (item.source.kind === "reasoning" || item.source.kind === "reasoning_unavailable") return <div data-thinking-marker="">{workRow(item)}</div>;
      if (item.source.kind === "interruption") return workRow(item);
      if (item.source.kind === "record") return <div data-internal-records="">{workRow(item)}</div>;
      if (item.source.kind === "unavailable" && sharedNode && (sharedNode.kind === "assistant_response" || sharedNode.kind === "user")) return <div data-items-unavailable-reason={item.source.reason}><BodyReadMessage model={model} node={sharedNode} displayText={displayText} />{item.source.reason ? <div class="caption muted" data-unavailable-reason="">{item.source.reason}</div> : null}</div>;
      if (item.source.kind === "unknown" || item.source.kind === "unavailable") {
        const source=item.source,handle=model.handle.value;
        const record="domain" in source&&source.namespace==="handoff"?handle?.handoff.value.find(record=>record.key===source.recordId):undefined;
        return <><div data-item-unavailable="" data-items-unavailable-reason={source.kind==="unavailable"?source.reason:undefined}>{workRow(item)}</div>{record?<LiveRecordChrome model={model} record={record}/>:null}</>;
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

export function LiveRecordChrome({ model, record }: { model: AppModel; record: HandoffRecord }) {
  const t=model.t.value;
  const incomplete = record.incomplete;
  return <div data-live-record-chrome={record.key}>
    {incomplete ? <div class="caption muted" data-live-incomplete="">{t("convo.liveIncomplete")}</div> : null}
  </div>;
}

export function OutputLimitNotice({ model, fact, openThreadSettings }: { model: AppModel; fact: { stop: true; sent_max_tokens?: number | null; source?: string; connection?: string }; openThreadSettings?: OpenThreadSettings }) {
  const t = model.t.value;
  const connection = fact.connection;
  const target = fact.source === "thread_override" && model.data.capabilities.value.includes("thread.settings") && openThreadSettings
    ? () => openThreadSettings("max_tokens")
    : fact.source === "connection" && connection && model.data.capabilities.value.includes("config.edit")
      ? () => model.navigateToSettingFocus({ view: "settings", section: "connections" }, `connections.${connection}.max_tokens`)
      : undefined;
  return <OutputLimitNoticeRow actions={<>{target ? <Button variant="ghost" onClick={target}>{t("convo.outputLimitAction")}</Button> : null}<Button variant="ghost" onClick={() => void model.send(t("convo.continue"))}>{t("convo.continue")}</Button></>}>
    <Icon role="conversation.outputLimit" size="small" /><span>{t(fact.sent_max_tokens == null ? "convo.outputLimitNoticeUnknown" : "convo.outputLimitNotice", { limit: fact.sent_max_tokens == null ? "" : String(fact.sent_max_tokens) })}</span>
  </OutputLimitNoticeRow>;
}

function outputLimitNoticeFacts(live: AttemptOutputLimit | null | undefined, saved?: import("../../../data/src").SavedOutputLimit) {
  const fact = live?.stop ? live : saved?.stop ? saved : undefined;
  return fact ? { stop: true as const, ...(fact.sent_max_tokens !== undefined ? { sent_max_tokens: fact.sent_max_tokens } : {}), ...(fact.source ? { source: fact.source } : {}), ...(fact.connection ? { connection: fact.connection } : {}) } : undefined;
}

function OwnSendContent({model,snapshot,plan,trailing,openThreadSettings}: {model:AppModel;snapshot:WindowAcceptedSnapshot;plan:ConversationDisplayPlan;trailing?:ComponentChildren;openThreadSettings?:OpenThreadSettings}) {
  const projection = useMemo(() => projectionFromDisplayPlan(plan), [plan.entries, plan.sequence, plan.workGroups]);
  const renderLocal=(message:import("../../../ui-core/src/model").PendingOwnMessage | Extract<import("../../../ui-core/src/own-send-presentation").PositionedOwnSendRow,{kind:"live"}>)=> { if ("kind" in message) { const fact = outputLimitNoticeFacts(message.outputLimit); return fact ? <OutputLimitNotice model={model} fact={fact} openThreadSettings={openThreadSettings} /> : null; } return <aside data-pending-own-message={message.operationId} data-pending-phase={message.phase}><Message bot={false} who={model.t.value("convo.you")} text={message.text} at={model.t.value(message.phase === "sending" || message.phase === "accepted" ? "composer.pending.waiting" : `composer.pending.${message.phase}`)} copyLabel={model.t.value("code.copy")} copiedLabel={model.t.value("code.copied")}/>
    {message.phase==="failed"||message.phase==="unconfirmed"?<><Button variant="ghost" disabled={!model.canResend(message)} onClick={()=>void model.resend(message)}>{model.t.value("action.retry")}</Button>{!model.canResend(message)?<span class="caption">{model.t.value("composer.retryUnavailable")}</span>:null}</>:null}</aside>; };
  return <SavedConversationItems model={model} projection={projection} displayPlan={plan} nodes={snapshot.rows}
    localRegion={plan.localRegion.tailRows.length?{kind:"unqualified",tailRows:plan.localRegion.tailRows,renderRow:renderLocal}:undefined}
    trailing={trailing} openThreadSettings={openThreadSettings}/>;
}

export function SavedWindowContent({ model, snapshot, openThreadSettings }: { model: AppModel; snapshot: WindowAcceptedSnapshot; openThreadSettings?: OpenThreadSettings }) {
  const handle = model.handle.value;
  const acceptedPlan = snapshot.displayPlan;
  const capability = model.longReader.value?.acceptedView.currentCapability;
  if (!acceptedPlan || acceptedPlan.acceptedGeneration !== snapshot.generation || acceptedPlan.revision !== snapshot.revision
    || acceptedPlan.capability !== capability || !(model.longReader.value?.acceptedView.isCurrent(snapshot) ?? false)) return null;
  return <OwnSendContent model={model} snapshot={snapshot} plan={acceptedPlan} openThreadSettings={openThreadSettings}
    trailing={<>{acceptedPlan.coverage==='unavailable' ? <div role="status" data-work-scope-rejected="" data-state-source="client" data-state-value="scope-qualification-rejected">CLIENT: {model.t.value('work.textUnavailable')} (scope-qualification-rejected)</div> : null}
    {handle?.handoffOverflow.value ? <div class="caption muted" data-live-overflow="">{model.t.value('convo.handoffLimit')}</div> : null}</>} />;
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
    case "running": case "waiting": return "thinking";
    default: return "neutral";
  }
}

function ConnectionRecovery({ model }: { model: AppModel }) {
  const t = model.t.value;
  return <><a class="nav-link" href={formatRoute({ view: "setup" })}>{t("setup.openConnection")}</a><External href={FIRST_SETUP_GUIDE}>{t("setup.guide")}</External></>;
}

export function ConversationStatus({ model }: { model: AppModel }) {
  const t = model.t.value;
  const work = model.work.value;
  const row = model.selectedRow.value;
  const status = model.replyPages.asked_by.value.items.some(r => r.recipient.kind === "name" && r.recipient.name === "human") ? "awaiting" : row?.status === "awaiting" ? "awaiting" : activityStatus(row?.summary.activity);
  const running = work.running[0];
  const start = running?.startedAt ? parseTime(running.startedAt) : undefined;
  const activity = row?.summary.activity;
  // The one place for the recovery reason and Retry; it shows under an awaiting word too.
  const recovery = model.recovery.value;
  const errorActivity = status === "error" && (activity === "recovery" || activity === "failed") ? activity : undefined;
  const character = errorActivity ?? status;
  const label = errorActivity ? t(`status.${errorActivity}`) : status === "running" && activity ? activityLabel(model.lang.value, activity) : status ? activityStatusLabel(t, status) : "";
  const line = <div key="conversation-status" class="work-row conversation-status">{status === "idle" ? <StatusMark status="idle" label={statusLabel(t, "idle")} /> : status ? <><ConversationCharacter name={statusCharacter(character ?? "neutral")} running={status === "running"} /><span>{label}</span>
    {running ? <>
      <span data-status-description>{running.label}</span>
      {work.running.length > 1 ? <span>{t("work.runningCount", { n: work.running.length })}</span> : null}
      {start === undefined ? null : <span>{formatDuration(model.now.value - start)}</span>}
    </> : null}
    {recovery ? <><span data-status-description>{recovery.message ?? recovery.hint}</span>{model.canRetry.value ? <Button aria-describedby="conversation-retry-note" onClick={() => void model.retry()}>{t("action.retry")}</Button> : null}{recovery.configuration ? <ConnectionRecovery model={model} /> : null}</> : null}
  </> : " "}</div>;
  // Supporting text under the one-line status (Material 3 supporting text): it wraps in full, never ellipsized.
  return <>{line}{recovery && model.canRetry.value ? <div key="conversation-retry-note" id="conversation-retry-note" class="conversation-retry-note muted" data-retry-note>{t("recovery.body")}</div> : null}
    <span key="conversation-announcement" class="conversation-announcement" data-conversation-announcement role="status" aria-live="polite" aria-atomic="true">
      {status === "idle" ? statusLabel(t, "idle") : label}
    </span>
  </>;
}

export const Output = memo(function Output({ model, id, command, complete, boxed }: { model: AppModel; id: string; command: string; complete: boolean; boxed?: boolean }) {
  const [raw, setRaw] = useState(false);
  const [wrap, setWrap] = useState(() => typeof matchMedia === "function" ? matchMedia("(max-width: 899px)").matches : true);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(max-width: 899px)");
    const update = () => setWrap(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const t = model.t.value;
  const output = useMemo(() => computed(() => model.outputs.value.get(id)), [model, id]);
  const out = output.value;
  const rendered = useMemo(() => !out || out.error ? undefined : renderOutput({ command, text: out.text, complete: complete && !out.loading && !out.cutOff }), [command, out?.text, complete, out?.loading, out?.cutOff, out?.error]);
  if (!out || (out.loading && out.text === "")) return <div class="log muted">{t("details.outputLoading")}</div>;
  if (out.error && out.text === "") return <div class="log muted">{t("details.outputError", { message: out.error })}</div>;
  return (
    <>
      <div class="output-actions"><Button onClick={() => { void navigator.clipboard.writeText(out.text).catch(() => {}); }}>{t("code.copy")}</Button><Button aria-pressed={wrap} onClick={() => setWrap(!wrap)}>{t("output.wrapLines")}</Button>
      {rendered ? <Button onClick={() => setRaw(!raw)}>{raw ? t("output.formatted") : t("output.raw")}</Button> : null}
      </div>
      <div class={`output-log${wrap ? " output-wrapped" : ""}`}>{rendered && !raw ? <OutputLines lines={rendered.lines} boxed={boxed ?? false} /> : <LogBlock text={out.text === "" ? t("details.outputEmpty") : out.text} boxed={boxed ?? false} />}</div>
      {out.error ? <div class="caption muted">{t("details.outputError", { message: out.error })}</div> : null}
      {out.cutOff ? <div class="caption muted">{t("details.outputMore")}</div> : null}
    </>
  );
});

const OUTPUT_OVERSCAN = 24;
const OUTPUT_WINDOW_THRESHOLD = 128;
export function outputLineRange(total: number, start: number, count: number): { first: number; last: number } {
  const first = Math.max(0, Math.min(total, start));
  return { first, last: Math.min(total, first + Math.max(0, count)) };
}

export function OutputLines({ lines, boxed }: { lines: readonly { text: string; kind: string }[]; boxed: boolean }) {
  const pre = useRef<HTMLPreElement>(null);
  const [range, setRange] = useState({ first: 0, last: OUTPUT_WINDOW_THRESHOLD });
  const windowed = lines.length > OUTPUT_WINDOW_THRESHOLD;
  useLayoutEffect(() => {
    if (!windowed) { setRange({ first: 0, last: lines.length }); return; }
    const element = pre.current;
    if (!element) return;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || element.firstElementChild?.getBoundingClientRect().height || 1;
    const visible = Math.ceil(element.clientHeight / lineHeight);
    const first = Math.max(0, Math.floor(element.scrollTop / lineHeight) - OUTPUT_OVERSCAN);
    setRange(outputLineRange(lines.length, first, visible + OUTPUT_OVERSCAN * 2));
  }, [lines.length, windowed]);
  const first = windowed ? range.first : 0;
  const last = windowed ? Math.min(lines.length, range.last) : lines.length;
  return <pre ref={pre} class={boxed ? "log boxed output-window" : "log output-window"} tabIndex={0} onScroll={event => {
    if (!windowed) return;
    const element = event.currentTarget;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 1;
    const visible = Math.ceil(element.clientHeight / lineHeight);
    const start = Math.max(0, Math.floor(element.scrollTop / lineHeight) - OUTPUT_OVERSCAN);
    setRange(outputLineRange(lines.length, start, visible + OUTPUT_OVERSCAN * 2));
  }}>{first > 0 ? "\n".repeat(first) : null}{lines.slice(first, last).map((line, index) => <span key={first + index} class={`output-${line.kind}`}>{line.text}{first + index < lines.length - 1 ? "\n" : ""}</span>)}{last < lines.length ? "\n".repeat(lines.length - last) : null}</pre>;
}

export function StepView({ model, step, display, openPolicy = CANONICAL_CASES.toolCall.openPolicy }: { model: AppModel; step: Step; display: WorkElementDisplay; openPolicy?: CanonicalCase["openPolicy"] }) {
  const t = model.t.value;
  const choice = model.toolStepChoices.value.get(step.executionId);
  const open = choice ?? (openPolicy !== "closed");
  useEffect(() => {
    if (!open || (display.detailPolicy!=="actual-safe-typed"&&display.detailPolicy!=="existing-shell-output")) return;
    return model.watchOutput(step.executionId);
  }, [model, open, step.executionId, display.detailPolicy]);
  // History links carry no exit code; the shell.list fact merged into the step does.
  const merged:WorkElementDisplay=display.state&&display.state.source==="wire"&&step.exitCode!==undefined&&step.status!==undefined?{...display,state:{...display.state,executionStatus:step.status,exitCode:step.exitCode}}:display;
  const formatted=formatWorkElementDisplay(merged);
  const shellDisplay=model.shells.value.has(step.executionId)?{...formatted,iconRole:"work.terminal" as const}:formatted;
  if(display.detailPolicy!=="actual-safe-typed"&&display.detailPolicy!=="existing-shell-output")return <WorkElementRow display={shellDisplay} anchorKey={step.executionId} detailPolicy={display.detailPolicy}/>;
  return <WorkElementRow display={shellDisplay} anchorKey={step.executionId} detailPolicy={display.detailPolicy} open={open} onToggle={(next, opener)=>{
    if (next && !open) model.openInPanel({ kind: "step", id: step.executionId }, panelFocusReturn(opener));
    if(next!==open)model.toolStepChoices.value=new Map(model.toolStepChoices.peek()).set(step.executionId,next);
  }}>
    {step.description ? <div class="mono muted caption">{step.command}</div> : null}
    <Output model={model} id={step.executionId} command={step.command ?? ""} complete={step.status === "completed" || step.status === "failed" || step.state === "exited"}/>
  </WorkElementRow>;
}

function allProseNode(node: HistoryItem): boolean {
  return node.items !== null && node.items !== undefined && node.items.length > 0 && node.items.every(item => item.kind === "text");
}

function BodyReadMessage({model,node,displayText}:{model:AppModel;node:HistoryItem;displayText:string|undefined}) {
  const nodeAuthoritative = allProseNode(node);
  const itemIdentity = nodeAuthoritative ? undefined : node.items?.find(item => item.kind === "text")?.item_identity;
  const t = model.t.value;
  const speaker = speakerOf(node);
  const sender = speakerDisplay(speaker, model);
  return <Message bot={speaker.kind === "shellboy"} who={sender.header ? { ...sender.header, role: t("convo.modelSender") } : sender.label} at={formatClock(node.provenance?.created_at)} text={model.bodyState(node.node_id!, itemIdentity)?.text ?? displayText ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
    <MessageRelation relationship={messageRelationship(node.provenance?.message, node.node_id)} t={t} />
    {sender.claim ? <div class="caption">{sender.claim}</div> : null}
    <BodyReadButton model={model} nodeId={node.node_id!} itemIdentity={itemIdentity} typedNode={nodeAuthoritative} unavailable={!nodeAuthoritative && node.items !== null} />
  </Message>;
}

function BodyReadButton({model,nodeId,itemIdentity,typedNode,unavailable}:{model:AppModel;nodeId:string;itemIdentity?:string;typedNode?:boolean;unavailable?:boolean}) {
  const body=model.bodyState(nodeId,itemIdentity);
  if (unavailable) return <span class="muted caption" data-body-unavailable="">{model.t.value("work.textUnavailable")}</span>;
  return <Button variant="ghost" onClick={() => void model.loadBody(nodeId, typedNode ? { kind: "typed", identity: undefined } : itemIdentity === undefined ? undefined : { kind: "typed", identity: itemIdentity })}>{body?.loading ? model.t.value("convo.loadingBody") : model.t.value("convo.fullMessage")}</Button>;
}

function speakerDisplay(speaker: Speaker, model: AppModel) {
  const t = model.t.value;
  const title = speaker.kind === "model" ? model.senderTitles.values.value.get(speaker.threadId) : undefined;
  return projectSpeakerDisplay(speaker, title, {
    you: t("convo.you"), shellboy: t("convo.shellboy"), cli: t("convo.cli"), model: t("convo.modelSender"),
    unknownModel: t("convo.unknownModelSender"), unknown: t("convo.unknownSender"),
    claimed: label => t("convo.senderClaimedLabel", { label }),
  });
}

function MessageRelation({ relationship, t }: { relationship: ReturnType<typeof messageRelationship>; t: AppModel["t"]["value"] }) {
  return relationship.kind==="request" ? <div class="caption" data-message-relation="request">{t("convo.relationRequest")} · {t(`convo.relation.${relationship.state}`)}{relationship.replyId ? <> <code>{relationship.replyId}</code></> : null}</div> : relationship.kind==="reply" ? <div class="caption" data-message-relation="reply">{t("convo.relationReply")} <code>{relationship.requestId}</code></div> : null;
}

function ProjectedMessage({ model, row, authorizedText, relationship, bodyPartial, bodyUnavailable, nodeAuthoritative }: { relationship:ReturnType<typeof messageRelationship>; model: AppModel; row: Extract<ConversationRow, {type:"message"}>; authorizedText: string; bodyPartial?: boolean; bodyUnavailable?: boolean; nodeAuthoritative?: boolean }) {
  const t = model.t.value;
  const threadId = model.handle.value?.threadId;
  const point = threadId !== undefined ? formatRoute({ view: "branches", threadId, nodeId: row.id }) : undefined;
  const found = model.rowMarks.value.get(row.id);
  const mark = found && threadId !== undefined ? <BranchMark href={formatRoute({ view: "branches", threadId, nodeId: found.nodeId })} label={found.branches === 1 ? t("branches.markOne") : t("branches.mark", { n: found.branches })} /> : null;
  const senderDisplay = speakerDisplay(row.speaker, model);
  const header = senderDisplay.header ? {...senderDisplay.header,role:t("convo.modelSender")} : senderDisplay.label;
  const body = model.bodyState(row.id, row.itemIdentity);
  const renderedText = body?.text ?? authorizedText;
  return (
    <Message bot={row.speaker.kind === "shellboy"} who={header} at={formatClock(row.at)} text={renderedText} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
      <MessageRelation relationship={relationship} t={t} />
      {row.speaker.kind === "model" ? <div class="caption sender-fact">
        {senderDisplay.claim ? <div>{senderDisplay.claim}</div> : null}
      </div> : senderDisplay.claim ? <div class="caption">{senderDisplay.claim}</div> : null}
      {(row.truncated || bodyPartial) && body?.text === undefined ? (
        <span class="more">
          {bodyUnavailable ? <span class="muted caption" data-body-unavailable="">{t("work.textUnavailable")}</span> : <Button variant="ghost" onClick={() => void model.loadBody(row.id, nodeAuthoritative ? { kind: "typed", identity: undefined } : row.itemIdentity === undefined ? undefined : { kind: "typed", identity: row.itemIdentity })}>
            {body?.loading ? t("convo.loadingBody") : t("convo.fullMessage")}
          </Button>}
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

const activitySections = [
  { key: "running", label: "work.running", kind: "step", icon: "work.command" },
  { key: "pending", label: "panel.pending", kind: "message", icon: "panel.awaiting_reply" },
] as const;

const possessionsSections = [
  { label: "panel.attachments", kind: "attachment", icon: "panel.attachment" },
] as const;

function PanelPossessions({ model }: { model: AppModel }) {
  const t = model.t.value;
  const state = model.attachmentSection.state.value;
  return <div class="panel-list" data-panel-list="possessions">
    {model.data.capabilities.value.includes(CAPABILITY_ARTIFACTS) ? <ArtifactList model={model} onSelect={(id, opener) => model.openInPanel({ kind: "artifact", id }, panelFocusReturn(opener), true)} /> : null}
    {state.items.length ? possessionsSections.map(section => <section key={section.kind}>
      <ListDivider label={t(section.label)} count={state.items.length} />
      {state.items.map(row => <ListRow key={row.attachment_id} id={row.attachment_id}
        title={row.path.split(/[\\/]/).filter(Boolean).at(-1) ?? row.path} icon={section.icon}
        subtitle={t(row.kind === "image" ? "panel.attachmentImage" : "panel.attachmentFile")}
        selected={model.panelOpener.value.possessions?.id === row.attachment_id}
        onSelect={opener => model.openInPanel({ kind: section.kind, id: row.attachment_id }, panelFocusReturn(opener), true)} />)}
    </section>) : null}
    {state.loading && !state.loaded || state.loadingMore ? <p role="status">{t("panel.attachmentsLoading")}</p> : null}
    {state.error ? <p role="alert">{t("panel.attachmentsFailed")}</p> : null}
    {!state.items.length && !(state.loading && !state.loaded) && !state.error ? <EmptyState compact role="empty.panelAttachments" title={t("panel.empty.attachments")} body={t("panel.empty.attachmentsBody")} /> : null}
    {state.cursor !== undefined ? <Button disabled={state.loading} onClick={() => model.attachmentSection.more()}>{t("panel.attachmentsMore")}</Button> : null}
    {state.capped ? <p class="muted caption">{t("panel.attachmentsCapped", { n: ATTACHMENT_RETENTION })}</p> : null}
  </div>;
}

function panelElapsed(now: number, startedAt?: string): string | undefined {
  const started = parseTime(startedAt);
  return started === undefined ? undefined : formatDuration(Math.max(0, now - started));
}

function panelFocusReturn(opener?: HTMLElement): (() => boolean) | undefined {
  if (!opener) return;
  return () => {
    if (!opener.isConnected || opener.closest("[hidden]")) return false;
    opener.focus();
    return opener.ownerDocument.activeElement === opener;
  };
}

function panelOperationBlocked(model: AppModel, id: string): boolean {
  const state = model.panelOperations.value.get(id);
  return state !== undefined && state.disposition !== "failed";
}

function workRefreshing(model: AppModel): boolean {
  const resource = model.handle.value?.work.value;
  return !!(resource?.loading || resource?.stale);
}

function panelCancel(model: AppModel, id: string, target: "pending" | "reply" = "pending") {
  return { key: "cancel", label: model.t.value("work.cancel"),
    disabled: panelOperationBlocked(model, id) || model.connection.value !== "connected" || (target === "pending" && workRefreshing(model)),
    run: () => { void model.runPanelOperation(id, { kind: "cancel", target }); },
  };
}

function panelOperationError(model: AppModel, id: string): string | undefined {
  const state = model.panelOperations.value.get(id);
  return state && state.disposition !== "pending" ? model.t.value(state.kind === "answer" ? "inbox.answerFailed" : "work.cancelFailed", { message: state.error }) : undefined;
}

function PanelActivity({ model }: { model: AppModel }) {
  const t = model.t.value;
  const work = model.work.value;
  const selected = model.panelOpener.value.work;
  const now = model.now.value;
  return <div class="panel-list" data-panel-list="work">
    {activitySections.map(section => {
      const rows = work[section.key];
      return rows.length ? <section key={section.key}><ListDivider label={t(section.label)} count={rows.length} />{rows.map(row => {
        const elapsed = panelElapsed(now, row.startedAt);
        const state = row.state === "accepted" ? t("work.accepted") : t("work.held");
        const command = section.kind === "step" ? row.command : undefined;
        // The Work projection already uses toolLabel for the owner description.
        const label = toolLabel(row.label, command, t("work.textUnavailable"));
        return <ListRow key={row.id} id={row.id} title={label} command={command?.trim() !== label ? command : undefined}
          subtitle={section.kind === "step" ? elapsed : [state, elapsed].filter(Boolean).join(" · ")} icon={section.icon}
          selected={selected?.kind === section.kind && selected.id === row.id}
          onSelect={opener => model.openInPanel({ kind: section.kind, id: row.id }, panelFocusReturn(opener), true)} menuLabel={t("panel.rowActions")}
          actions={section.kind === "message" ? [panelCancel(model, row.id)] : undefined} error={panelOperationError(model, row.id)} />;
      })}</section> : null;
    })}
    {work.partial ? <div class="caption muted">{t("work.partial")}</div> : null}
    {workRefreshing(model) && work.running.length + work.pending.length > 0 ? <div class="caption muted">{t("work.stale")}</div> : null}
    {!work.running.length && !work.pending.length && !work.partial ? <EmptyState compact role="empty.panelActivity" title={t("panel.empty.work")} body={t("panel.empty.workBody")} /> : null}
  </div>;
}

function PanelReplies({ model, side }: { model: AppModel; side: "owed_by" | "asked_by" }) {
  const t = model.t.value;
  const tab = side === "owed_by" ? "reply-needed" : "awaiting-reply";
  const page = model.replyPages[side].value;
  return <div class="panel-list" data-panel-list={tab}>
    {page.items.map(reply => {
      const human = reply.recipient.kind === "name" && reply.recipient.name === "human";
      const peer = side === "owed_by" ? reply.sender.thread_id : reply.recipient.kind === "thread" ? reply.recipient.thread_id : undefined;
      const title = peer ? model.rowById.value.get(peer)?.summary.title || peer : undefined;
      const senderSpeaker = speakerOf({ kind: "message", provenance: { sender: reply.sender } });
      const senderDisplay = speakerDisplay(senderSpeaker, model);
      const senderLabel = senderDisplay.header
        ? `${senderDisplay.header.label}${senderDisplay.header.fallbackId ? ` ${senderDisplay.header.fallbackId}` : ""}${senderDisplay.claim ? ` · ${senderDisplay.claim}` : ""}`
        : [senderDisplay.label, senderDisplay.claim].filter(Boolean).join(" · ");
      const party = side === "owed_by" ? senderLabel
        : human ? t("convo.you") : title ?? (reply.recipient.kind === "name" ? reply.recipient.name : undefined);
      const target = peer && peer !== model.selectedId.value ? formatRoute({ view: "conversation", threadId: peer }) : undefined;
      const actions = [...(target ? [{ key: "open", label: t("panel.openThread"), href: target }] : []),
        ...(side === "asked_by" ? [panelCancel(model, reply.message_id, "reply")] : [])];
      return <ListRow key={reply.message_id} id={reply.message_id} title={[party, reply.excerpt || t("work.textUnavailable")].filter(Boolean).join(" · ")}
        subtitle={panelElapsed(model.now.value, reply.created_at)} waiting={side === "asked_by" && human} selected={model.panelOpener.value[tab]?.id === reply.message_id}
        menuLabel={t("panel.rowActions")} actions={actions} error={panelOperationError(model, reply.message_id)} onSelect={opener => model.openInPanel({ kind: "reply", id: reply.message_id, replySide: side }, panelFocusReturn(opener), true)} />;
    })}
    {page.loading && !page.loaded || page.loadingMore ? <p role="status">{t("common.loading")}</p> : null}
    {page.error ? <p role="alert">{errorMessage(page.error)}</p> : null}
    {!page.items.length && !(page.loading && !page.loaded) && !page.error ? <EmptyState compact role={side === "owed_by" ? "empty.panelReplies" : "empty.panelAwaiting"} title={t(side === "owed_by" ? "panel.empty.owed" : "panel.empty.asked")} body={t(side === "owed_by" ? "panel.empty.owedBody" : "panel.empty.askedBody")} /> : null}
    {page.cursor ? <Button disabled={page.loading} onClick={() => model.replyPages.more(side)}>{t("panel.attachmentsMore")}</Button> : null}
  </div>;
}

function ThreadAnalytics({ model, threadId }: { model: AppModel; threadId: string }) {
  const [observation, setObservation] = useState<ReturnType<AppModel["observeThreadAnalytics"]>>();
  useEffect(() => {
    const next = model.observeThreadAnalytics(threadId);
    setObservation(next);
    return () => next.close();
  }, [model, threadId]);
  const t = model.t.value;
  const usage = observation?.usage.value;
  const rows = usage ? [
    { key: t("usage.input"), value: tokenTotal(t, usage.conversation.input, usage.scopeIncomplete), mono: true },
    { key: t("usage.output"), value: tokenTotal(t, usage.conversation.output, usage.scopeIncomplete), mono: true },
    { key: t("usage.cached"), value: tokenTotal(t, usage.conversation.cached, usage.scopeIncomplete), mono: true },
    { key: t("series.cacheRate"), value: usage.cachedPercent === undefined ? t("analytics.noValue") : `${usage.cachedPercent}%`, mono: true },
    { key: t("usage.attempts"), value: usage.attempts, mono: true },
  ] : [];
  const summary = usage?.summary;
  const compactions = observation?.compactions.value;
  const status = observation?.status.value;
  const unavailable = (failed: boolean | undefined) => !status || status.loading ? t("common.loading") : t(failed ? "threadSettings.infoReadFailed" : "common.notReadable");
  const unreadable = t("common.notReadable");
  return <div class="stack" data-panel-info="">
    <Section title={t("usage.conversation")} sub={t("usage.retained")} source={<code>usage.get</code>}>
      {rows.length ? <KeyValue rows={rows} /> : <p class="muted caption">{unavailable(status?.usageFailed)}</p>}
    </Section>
    <Section title={t("usage.summary")} source={<code>usage.get</code>}>
      {summary ? <KeyValue rows={[
        { key: t("usage.input"), value: tokenTotal(t, summary.parts.input, summary.incomplete), mono: true },
        { key: t("usage.cached"), value: tokenTotal(t, summary.parts.cached, summary.incomplete), mono: true },
        { key: t("usage.output"), value: tokenTotal(t, summary.parts.output, summary.incomplete), mono: true },
        { key: t("usage.requests"), value: summary.requests === undefined ? t("analytics.noValue") : summary.incomplete ? t("usage.minimum", { value: summary.requests }) : summary.requests, mono: true },
      ]} /> : <p class="muted caption">{unavailable(status?.usageFailed)}</p>}
    </Section>
    <Section title={t("usage.recentCompaction")} source={<code>compact.list</code>}>
      {compactions?.length ? <DataTable caption={t("ana.section.compaction")} flat columns={[{ label: t("compact.at") }, { label: t("compact.kind") }, { label: t("threadSettings.inputBeforeAfter") }]}
        rows={compactions.map(event => ({ key: event.id, cells: [formatClock(event.at, true) ?? unreadable, event.kind,
          t("threadSettings.inputRange", { before: event.triggerInput === undefined ? unreadable : formatTokens(event.triggerInput), after: event.afterInput === undefined ? unreadable : formatTokens(event.afterInput) })] }))} />
        : compactions ? <EmptyState compact role="empty.panelCompactions" title={t("panel.empty.compactions")} body={t("panel.empty.compactionsBody")} /> : <p class="muted caption">{unavailable(status?.compactionsFailed)}</p>}
    </Section>
  </div>;
}

/** Core's message and attachment delivery states, in Shellboy's own words; an unknown value stays as sent. */
function deliveryStateLabel(t: AppModel["t"]["value"], state: string): string {
  return state === "accepted" ? t("work.accepted") : state === "held" ? t("work.held")
    : state === "applied" ? t("work.applied") : state === "cancelled" ? t("work.cancelled") : state;
}

function PanelDetail({ model, tabLabel, onBack }: { model: AppModel; tabLabel: string; onBack: () => void }) {
  const t = model.t.value;
  const detail = model.panelDetail.value;
  const step = model.selectedStep.value;
  const running = detail?.kind === "step" ? model.work.value.running.find(row => row.id === detail.id) : undefined;
  const started = formatClock(step?.startedAt ?? running?.startedAt, true);
  const stepId = detail?.kind === "step" ? detail.id : undefined;
  useEffect(() => stepId && (step || running) ? model.watchOutput(stepId) : undefined, [model, stepId, !!(step || running)]);
  useEffect(() => {
    if (!detail || (detail.kind !== "message" && detail.kind !== "reply") || model.bodyState(detail.id)) return;
    void model.loadBody(detail.id);
  }, [model, detail]);
  const backRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (backRef.current?.offsetParent) backRef.current.focus(); }, []);
  const back = <Button buttonRef={backRef} variant="ghost" data-panel-back onClick={onBack}><Icon role="panel.back" size="small" />{tabLabel}</Button>;
  if (!detail) return null;
  const error = panelOperationError(model, detail.id);
  if (detail.kind === "step") {
    const command = step?.command ?? running?.command;
    const description = step?.description?.trim() || (running?.label !== running?.command?.trim() ? running?.label : undefined);
    const label = toolLabel(description, command, t("work.textUnavailable"));
    const elapsed = step ? stepDuration(step, model.now.value) : undefined;
    return <section class="panel-detail" data-panel-detail=""><div class="panel-detail-head">{back}<h3>{t("details.title")}</h3></div>
      {step || running ? <><div class="cmd"><Icon role="work.command" />{description ? <span class="stack"><span>{label}</span>{command && command.trim() !== label ? <span class="mono muted caption">{command}</span> : null}</span> : <span>{label}</span>}</div>
        <KeyValue rows={[
          ...(step?.status ? [{ key: t("details.status"), value: <StatusMark shell status={step.status} label={activityStatusLabel(t, step.status)} /> }] : []),
          ...(elapsed ? [{ key: t("details.duration"), value: elapsed, mono: true }] : []),
          ...(typeof step?.exitCode === "number" ? [{ key: t("details.exit"), value: step.exitCode, mono: true }] : []),
          ...(started ? [{ key: t("details.started"), value: started, mono: true }] : []),
          ...(step?.cwd ? [{ key: t("details.directory"), value: step.cwd, mono: true }] : []),
        ]} />
        <Output model={model} id={detail.id} command={command ?? ""} complete={step?.status === "completed" || step?.status === "failed" || step?.state === "exited"} boxed />
      </> : <p class="muted caption">{t("work.textUnavailable")}</p>}
    </section>;
  }
  if (detail.kind === "message") {
    const row = model.work.value.pending.find(item => item.id === detail.id);
    const action = row ? panelCancel(model, row.id) : undefined;
    return <section class="panel-detail" data-panel-detail=""><div class="panel-detail-head">{back}<h3>{t("work.pending")}</h3></div>
      {row ? <KeyValue rows={[{ key: t("work.pending"), value: model.bodyState(row.id)?.text ?? (row.label || t("work.textUnavailable")) }, { key: t("details.status"), value: deliveryStateLabel(t, row.state) }]} /> : <p class="muted caption">{t("work.textUnavailable")}</p>}
      {action ? <Button disabled={action.disabled} onClick={action.run}>{action.label}</Button> : null}
      {error ? <p role="alert">{error}</p> : null}
      {model.bodyState(detail.id)?.loading ? <p role="status">{t("convo.loadingBody")}</p> : null}
    </section>;
  }
  if (detail.kind === "artifact") return <section class="panel-detail" data-panel-detail=""><div class="panel-detail-head">{back}</div><ArtifactDetail model={model} /></section>;
  if (detail.kind === "attachment") {
    const attachments = model.attachmentSection.state.value;
    const row = attachments.items.find(item => item.attachment_id === detail.id);
    return <section class="panel-detail" data-panel-detail=""><div class="panel-detail-head">{back}<h3>{t("panel.attachments")}</h3></div>
      {attachments.error ? <p role="alert">{t("panel.attachmentsFailed")}</p> : null}
      {row ? <KeyValue rows={[
        { key: t("panel.attachmentPath"), value: <bdi>{row.path}</bdi> },
        { key: t("panel.attachmentKind"), value: t(row.kind === "image" ? "panel.attachmentImage" : "panel.attachmentFile") },
        { key: t("details.status"), value: deliveryStateLabel(t, row.delivery_status) },
        { key: t("panel.attachmentManaged"), value: t(row.managed ? "panel.attachmentYes" : "panel.attachmentNo") },
        { key: t("panel.attachmentSelected"), value: t(row.selected ? "panel.attachmentYes" : "panel.attachmentNo") },
        ...(row.unavailable_reason ? [{ key: t("panel.attachmentUnavailable"), value: row.unavailable_reason }] : []),
      ]} /> : <p class="muted caption">{t(attachments.complete ? "work.textUnavailable" : "panel.attachmentOutsideCoverage")}</p>}
    </section>;
  }
  const side = detail.replySide ?? "asked_by";
  const reply = model.replyPages[side].value.items.find(row => row.message_id === detail.id);
  const body = model.bodyState(detail.id);
  const peer = reply && (side === "owed_by" ? reply.sender.thread_id : reply.recipient.kind === "thread" ? reply.recipient.thread_id : undefined);
  const replyCancel = reply && side === "asked_by" ? panelCancel(model, reply.message_id, "reply") : undefined;
  const canAnswer = reply && (side === "owed_by" || reply.recipient.kind === "name" && reply.recipient.name === "human");
  return <section class="panel-detail" data-panel-detail=""><div class="panel-detail-head">{back}<h3>{tabLabel}</h3></div>
    {canAnswer ? <QuestionCard id={`panel-${reply.message_id}`} label={tabLabel} waitingWord={side === "asked_by" ? t("status.awaiting") : undefined} question={body?.text ?? reply.excerpt} answerLabel={t("inbox.answer")} submitLabel={t("inbox.answerResume")} error={error} busy={panelOperationBlocked(model, reply.message_id)} onAnswer={text => { void model.runPanelOperation(reply.message_id, { kind: "answer", text, side }); }} />
      : <p>{body?.text ?? reply?.excerpt ?? t("work.textUnavailable")}</p>}
    {peer && peer !== model.selectedId.value ? <a href={formatRoute({ view: "conversation", threadId: peer })}>{model.rowById.value.get(peer)?.summary.title || peer}</a> : null}
    {replyCancel ? <Button disabled={replyCancel.disabled} onClick={replyCancel.run}>{replyCancel.label}</Button> : null}
  </section>;
}

function RightPanel({ model, panelCollapsed = false, phone, destination, clearDestination }: { model: AppModel; panelCollapsed?: boolean; phone?: boolean; destination?: SettingsDestination | undefined; clearDestination: () => void }) {
  const t = model.t.value;
  const caps = model.data.capabilities.value;
  const supportsAttachments = caps.includes(CAPABILITY_ATTACHMENT_PAGE);
  const supportsArtifacts = caps.includes(CAPABILITY_ARTIFACTS);
  const owner = model.data.owner.value;
  const threadId = model.handle.value?.threadId;
  const activeAttachments = supportsAttachments && !panelCollapsed && model.panelTab.value === "possessions";
  useEffect(() => activeAttachments && owner.state === "connected" && threadId
    ? model.attachmentSection.observe(threadId) : undefined, [model, activeAttachments, owner, threadId]);
  const selectedTab = !(supportsAttachments || supportsArtifacts) && model.panelTab.value === "possessions" ? "work" : model.panelTab.value;
  const replyCount = (side: "owed_by" | "asked_by") => {
    return formatCount(model.details.value?.pending_replies?.[side]);
  };
  const tabs = [
    { id: "work", label: t("panel.tab.work"), icon: "panel.work" as const, count: model.work.value.running.length + model.work.value.pending.length },
    { id: "reply-needed", label: t("panel.tab.reply_needed"), icon: "panel.reply_needed" as const, count: replyCount("owed_by") },
    { id: "awaiting-reply", label: t("panel.tab.awaiting_reply"), icon: "panel.awaiting_reply" as const, count: replyCount("asked_by") },
    ...((supportsAttachments || supportsArtifacts) ? [{ id: "possessions", label: t("panel.tab.possessions"), icon: "panel.attachment" as const }] : []),
    { id: "info", label: t("threadSettings.appearance"), icon: "panel.information" as const },
    { id: "settings", label: t("threadSettings.tab"), icon: "panel.threadSettings" as const },
  ];
  const detail = model.panelDetail.value;
  useEffect(() => {
    if (panelCollapsed || !detail) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && event.target instanceof Node && root.current?.contains(event.target)) {
        event.preventDefault(); closeDetail();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [model, detail, panelCollapsed]);
  const root = useRef<HTMLElement>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const panel = root.current;
    if (!panel) return;
    const publish = () => setPanelVisible(getComputedStyle(panel).display !== "none");
    const observer = new ResizeObserver(publish);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const artifactId = detail?.kind === "artifact" ? detail.id : undefined;
  const artifactsShown = supportsArtifacts && (phone || panelVisible) && !panelCollapsed && model.panelTab.value === "possessions";
  useEffect(() => artifactsShown && owner.state === "connected" && threadId
    ? model.artifacts.observeList(threadId) : undefined, [model, artifactsShown, owner, threadId]);
  useEffect(() => artifactsShown && owner.state === "connected" && threadId && artifactId
    ? model.artifacts.observeHistory(threadId, artifactId) : undefined, [model, artifactsShown, owner, threadId, artifactId]);
  const usageThread = panelVisible && !panelCollapsed && selectedTab === "info" && !detail && owner.state === "connected" ? threadId : undefined;
  const usageKey = usageThread && owner.state === "connected" ? JSON.stringify([owner.info.instance_id, usageThread]) : undefined;
  const focusAfterBack = useRef<{ tab: typeof model.panelTab.value; restore?: () => boolean }>();
  useLayoutEffect(() => {
    const focus = focusAfterBack.current;
    focusAfterBack.current = undefined;
    if (focus && focus.tab === model.panelTab.peek() && !model.panelDetail.peek() && !panelCollapsed && !focus.restore?.()) {
      root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
  }, [detail, panelCollapsed, model]);
  const closeDetail = () => {
    const tab = model.panelTab.peek();
    const restore = model.panelDetail.peek()?.opener;
    focusAfterBack.current = { tab, restore };
    model.closePanelDetail();
  };
  const select = (id: string) => { clearDestination(); model.setPanelTab(id as import("../../../ui-core/src/model").RightPanelTab); };
  return <aside id="conversation-right-panel" ref={root} class={`details${panelCollapsed ? " details-collapsed" : ""}`} aria-label={t("panel.title")} data-panel-root="" data-phone-panel={phone || undefined} data-panel-rail={panelCollapsed ? "" : undefined}>
    <PanelTabs label={t("panel.title")} items={tabs} selected={selectedTab} rail={panelCollapsed} onSelect={select} />
    <div class="panel-pages">
      {tabs.map(tab => {
        const active = tab.id === selectedTab;
        const drilledIn = active && !panelCollapsed && detail && (selectedTab === "possessions") === (detail.kind === "attachment" || detail.kind === "artifact");
        return <PanelPage key={tab.id} id={tab.id} hidden={!active || panelCollapsed}>
          {tab.id === "settings" ? (active && !panelCollapsed && model.details.value ? <ThreadSettingsPanel key={owner.state === "connected" ? owner.info.instance_id ?? "connected" : owner.state} model={model} details={model.details.value} destination={destination} /> : null) : <div class="panel-list-frame" hidden={!!drilledIn}>{tab.id === "work" ? <PanelActivity model={model} /> : tab.id === "info" ? (usageThread ? <ThreadAnalytics key={usageKey} model={model} threadId={usageThread} /> : null) : tab.id === "possessions" ? <PanelPossessions model={model} /> : <PanelReplies model={model} side={tab.id === "reply-needed" ? "owed_by" : "asked_by"} />}</div>}
          {drilledIn ? <PanelDetail key={`${detail.kind}:${detail.id}`} model={model} tabLabel={tab.label} onBack={closeDetail} /> : null}
        </PanelPage>;
      })}
    </div>
    {!phone ? <ShellFooter side="right"><ShellToggle panel expanded={!panelCollapsed} label={t(panelCollapsed ? "panel.expand" : "panel.collapse")} onClick={() => model.togglePanel()} /></ShellFooter> : null}
  </aside>;
}

export function OrderedHistory({ model, handle, win, t, openThreadSettings }: { model: AppModel; handle: NonNullable<AppModel["handle"]["value"]>; win: AppModel["longReader"]["value"]; t: AppModel["t"]["value"]; openThreadSettings?: OpenThreadSettings }) {
  const [boundary, setBoundary] = useState<{ attempt: string; ordinal: number } | undefined>();
  useEffect(() => {
    let attempt: string | undefined;
    return effect(() => {
      const next = handle.handoff.value[0]?.attemptId;
      if (next === attempt) return;
      attempt = next;
      setBoundary(next === undefined ? undefined : { attempt: next, ordinal: win?.total ?? 0 });
    });
  }, [handle, win]);
  if (!model.historySupported) return <Notice tone="bad" title={t("convo.unsupportedOwner")} />;
  if (!win) return <LoadingRows label={t("convo.loading")} rows={5} />;
  return <WindowedScroll model={model} win={win} live={null} renderRow={() => <></>}
    renderAcceptedView={snapshot => <SavedWindowContent model={model} snapshot={snapshot} openThreadSettings={openThreadSettings} />}
    liveBoundary={boundary?.ordinal} />;
}

export function Conversation({ model, panelCollapsed = false, rightPanelWidth, onPanelWidth, phonePanel, onTogglePhonePanel, onClosePhonePanel, onOpenPhonePanel }: { model: AppModel; panelCollapsed?: boolean; rightPanelWidth?: number; onPanelWidth?: (width: number) => void; phonePanel?: boolean; onTogglePhonePanel?: () => void; onClosePhonePanel?: () => void; onOpenPhonePanel?: () => void }) {
  const t = model.t.value;
  const handle = model.handle.value;
  const win = model.longReader.value;

  const details = model.details.value;
  const context = model.context.value;
  const root = useRef<HTMLDivElement>(null);
  const hasComposer = !!handle;
  useLayoutEffect(() => {
    const frame = root.current?.closest<HTMLElement>(".app");
    const viewport = window.visualViewport;
    if (!hasComposer || !frame || !viewport) return;
    const height = "--conversation-viewport-height";
    const update = () => {
      // Ignore pinch zoom: it should magnify the page without reflowing it.
      if (frame.clientWidth > 0 && frame.clientWidth <= 899 && viewport.scale === 1 && viewport.height > 0) {
        const bottom = viewport.offsetTop + viewport.height;
        frame.style.setProperty(height, `${Math.max(0, bottom - frame.getBoundingClientRect().top)}px`);
      } else frame.style.removeProperty(height);
    };
    update();
    window.addEventListener("resize", update);
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      frame.style.removeProperty(height);
    };
  }, [hasComposer]);
  const [settingsDestination, setSettingsDestination] = useState<SettingsDestination>();
  const clearDestination = () => setSettingsDestination(undefined);
  const tab = model.panelTab.value;
  useLayoutEffect(() => {
    if (settingsDestination && (settingsDestination.thread !== handle?.threadId || tab !== "settings")) clearDestination();
  }, [settingsDestination, handle, tab]);
  const destination = settingsDestination?.thread === handle?.threadId ? settingsDestination : undefined;
  const openThreadPanel = (tab: "info" | "settings", field: SettingsDestination["field"] = "connection") => {
    if (tab === "settings" && handle) {
      const request: SettingsDestination = { thread: handle.threadId, field,
        consume: () => setSettingsDestination(current => current === request ? undefined : current) };
      setSettingsDestination(request);
    } else clearDestination();
    const pane = root.current?.parentElement?.querySelector<HTMLElement>("[data-panel-root]");
    model.setPanelTab(tab);
    if (pane && getComputedStyle(pane).display === "none") onOpenPhonePanel?.();
  };
  const send = model.sendState.value;
  const pendingOwn = model.pendingOwnMessage.value;
  const sendBlocked = model.ownSendBlocked();
  const conn = model.connection.value;
  const diagnostic = win?.diagnostic.value;

  return (
    <>
      <div ref={root} class="convo">
        {diagnostic ? <output hidden data-window-diagnostic="true"
          data-reason={diagnostic.reason} data-generation={diagnostic.generation}
          data-revision={diagnostic.revision ?? ""} data-owner-epoch={diagnostic.ownerEpoch} /> : null}
        {handle ? <OrderedHistory model={model} handle={handle} win={win} t={t} openThreadSettings={field => openThreadPanel("settings", field)} /> :
          <EmptyState role="empty.noThread" title={t("convo.noThread")} body={t("convo.noThreadBody")}>
            <Button variant="primary" onClick={() => void model.createThread()}>{t("action.new")}</Button>
          </EmptyState>}
        <ConversationStatus key="permanent-conversation-status" model={model} />
        {handle ? <div class="dock">
          {send.kind === "failed" ? <Notice tone="bad" actions={send.configuration ? <ConnectionRecovery model={model} /> : undefined}>{t("composer.failed", { message: send.message })}</Notice> : null}
          {send.kind === "unconfirmed" ? (
            <Notice tone="wait" actions={<Button variant="warn" disabled={!model.canResend()} onClick={() => void model.resend(pendingOwn)}>{t("composer.retry")}</Button>}>
              {t("composer.unconfirmed")}{!model.canResend()?<div>{t("composer.retryUnavailable")}</div>:null}
            </Notice>
          ) : null}
          <Composer
            label={t("composer.label")}
            placeholder={t("composer.placeholder")}
            hint={pendingOwn ? t(`composer.pending.${pendingOwn.phase}`) : t("composer.hint")}
            draftStatus={text=>{const admission=model.localSendAdmission(text);return {blocked:admission!=="ready",hint:admission==="slotsfull"?t("composer.pending.slotsfull"):admission==="bytesfull"?t("composer.pending.bytesfull"):pendingOwn?t(`composer.pending.${pendingOwn.phase}`):t("composer.hint")};}}
            start={details ? <ModelPicker model={model} details={details} onThreadSettings={() => openThreadPanel("settings")} /> : undefined}
            context={context ? <ContextRing fill={context.fill} state={context.state} label={t("context.title")} stateLabel={t(`context.state.${context.state}`)} onOpen={() => openThreadPanel("info")} /> : undefined}
            sendLabel={t("composer.send")}
            canSend={conn === "connected" && !sendBlocked}
            busy={send.kind === "sending"}
            draftScope={handle.threadId}
            onSend={(text,onReserved) => model.send(text,onReserved)}
            stop={model.canStop.value ? { label: t("composer.stop"), run: () => void model.stop() } : undefined}
          />
        </div> : null}
        {handle ? <div class="phone-panel-footer"><ShellFooter side="right"><ShellToggle panel expanded={!!phonePanel} label={t(phonePanel ? "panel.collapse" : "panel.expand")} onClick={() => onTogglePhonePanel?.()} /></ShellFooter></div> : null}
      </div>
      {handle && !phonePanel && onPanelWidth ? <LayoutSeparator side="right" label={t("panel.resize")} controls="conversation-right-panel"
        width={readRightPanelWidth(rightPanelWidth)} min={RIGHT_PANEL_WIDTH_MIN} max={RIGHT_PANEL_WIDTH_MAX}
        disabled={panelCollapsed} onWidth={onPanelWidth} /> : null}
      {handle && !phonePanel ? <RightPanel key={handle.threadId} model={model} panelCollapsed={panelCollapsed} destination={destination} clearDestination={clearDestination} /> : null}
      {handle && phonePanel ? <WorkSheet open title={t("panel.title")} closeLabel={t("common.close")} onClose={() => onClosePhonePanel?.()} getReturnFocusTarget={() => root.current?.querySelector<HTMLElement>(".phone-panel-footer .shell-toggle-panel") ?? null}><RightPanel key={handle.threadId} model={model} phone destination={destination} clearDestination={clearDestination} /></WorkSheet> : null}
    </>
  );
}
