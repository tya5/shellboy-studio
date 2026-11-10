import type { HandoffRecord } from "../../../data/src/handoff";
import { senderFact } from "../../../data/src/sender";
import { projectHistoryWindowItems, projectSavedItems, normalizeLiveWorkFacts, type NormalizedSavedItem } from "../../../ui-core/src/conversation-items";
import { projectConversation } from "../../../ui-core/src/conversation";
import type { HistoryItem } from "../../../data/src/protocol";
import { Markdown } from "../system/components/Message";
import type { WindowAcceptedSnapshot } from "../../../ui-core/src/window";
import type { ComponentChildren } from "preact";
import type { SavedItemProjection } from "../../../ui-core/src/conversation-items";
import { ConversationItems, type ConversationItem, type ConversationToolSummary, type ConversationWorkGroup } from "./ConversationItems";
import { characterAssets } from "../system/character-assets";
import { effect } from "@preact/signals-core";
import { MonitorPopover } from "../system/components/MonitorPopover";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { toolLabel, activityLabel, renderOutput, formatClock, formatDuration, formatRoute, formatTokens, parseTime, statusLabel, type AppModel, type ConversationRow, type StepRow as Step } from "../../../ui-core/src";
import { ScrollIntent } from "./scrollIntent";
import { LiveMessage } from "./LiveMessage";
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
export function SavedConversationItems({ model, projection, renderBefore, trailing, nodes }: { model: AppModel; projection: SavedItemProjection & { sequence?: readonly ({kind: "conversation"; itemKey: string} | {kind: "work"; groupKey: string})[]; workGroups?: readonly ConversationWorkGroup[] }; nodes?: readonly HistoryItem[]; renderBefore?: (item: ConversationItem) => ComponentChildren; trailing?: ComponentChildren }) {
  const t = model.t.value;
  const allSteps = model.conversation.value.flatMap(row => row.type === "steps" ? row.steps : []);
  const [openMemberships, setOpenMemberships] = useState<ReadonlySet<string>>(() => new Set());
  const membershipKey = (summary: { memberKeys: readonly string[] }) => JSON.stringify(summary.memberKeys);
  const memberships = new Set((projection.workGroups ?? projection.toolSummaries).map(membershipKey));
  useLayoutEffect(() => {
    setOpenMemberships(previous => {
      const kept = new Set([...previous].filter(key => memberships.has(key)));
      return kept.size === previous.size ? previous : kept;
    });
  }, [projection]);
  const opened = (summary: { memberKeys: readonly string[] }) => openMemberships.has(membershipKey(summary));
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
    const label = [t("work.group"), ...(group.unknownToolCount ? [t("work.unknownTools")] : [t("tools.count", { n: group.executionIds.length })]), ...(unknown ? [t("work.textUnavailable")] : []), ...(failures ? [t("tools.nonzero", {n: failures})] : []), ...(group.interrupted ? [t("status.stopped")] : []), ...((group.continuationBefore !== "closed" || group.continuationAfter !== "closed") ? [t("work.partial")] : [])].join(" · ");
    return <details class="step step-group" open={opened(group)} data-work-group={group.key} data-key={group.key} data-heading-anchor-key={group.firstMemberKey} data-heading-member-keys={JSON.stringify(group.memberKeys)} onToggle={event => {
      const open = event.currentTarget.open;
      setOpenMemberships(previous => {
        const next = new Set([...previous].filter(key => memberships.has(key)));
        if (open) next.add(membershipKey(group)); else next.delete(membershipKey(group));
        return next;
      });
    }}><summary data-work-heading=""><Icon name="term" /><span class="tool-group-label">{label}</span>{status ? <StatusMark status={status} label={statusLabel(t, status)} /> : null}<span class="meta" /></summary><div class="step-group-list">{children}</div></details>;
  };
  return <ConversationItems {...projection} renderWorkGroup={projection.workGroups ? renderWorkGroup : undefined} renderBefore={renderBefore} trailing={trailing} isItemHidden={hidden} renderHeading={summary => {
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
        const next = new Set([...previous].filter(key => memberships.has(key)));
        if (open) next.add(membershipKey(summary)); else next.delete(membershipKey(summary));
        return next;
      });
    }}>{null}</StepRow></section>;
  }}
    renderItem={item => {
      if (item.source.kind === "text" || item.source.kind === "user" || item.source.kind === "summary") {
        const node = item.source.nodeId ? nodes?.find(node => node.node_id === item.source.nodeId) : undefined;
        if (!node) return "domain" in item.source ? <div data-live-overlay=""><Message bot who={t("convo.shellboy")} at={t("convo.live")} text={item.source.text ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} /></div> : <Markdown text={item.source.text ?? ""} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} />;
        const fact = senderFact(node.provenance?.sender);
        const speaker: Extract<ConversationRow, { type: "message" }>["speaker"] = node.kind === "assistant_response" ? { kind: "shellboy" }
          : fact.kind === "human" ? { kind: "you" } : fact.kind === "model" ? fact
          : fact.kind === "external_cli" ? (fact.label?.trim() ? { kind: "other", label: `CLI: ${fact.label}` } : { kind: "cli" })
          : { kind: "unknown", model: fact.kind === "unknown_model", label: fact.label };
        return <><RowView model={model} authorizedText={item.source.text ?? ""} row={{ type: "message", id: node.node_id!, speaker, text: item.source.text ?? "", truncated: false, at: node.provenance?.created_at }} />{item.source.kind === "text" && item.source.textComplete === false ? <div class="caption muted" data-item-partial="">{t("work.partial")}</div> : null}</>;
      }
      if (item.source.kind === "tool") {
        const ids = item.source.executionIds ?? (item.source.executionId ? [item.source.executionId] : []);
        const steps = model.conversation.value.flatMap(row => row.type === "steps" ? row.steps : []);
        if (!ids.length) return <div class="caption muted" data-execution-unavailable="">{t("work.textUnavailable")}</div>;
        return ids.map(id => {
          const step = steps.find(step => step.executionId === id);
          return <div key={id} data-execution-id={id}>{hidden(item) ? null : step ? <StepView model={model} step={step} /> : <div class="caption muted" data-execution-unresolved="">{t("work.textUnavailable")}</div>}</div>;
        });
      }
      if (item.source.kind === "ordinaryEmpty") return <div class="caption muted" data-empty-ordinary="">{t("work.textUnavailable")}</div>;
      if (item.source.kind === "reasoning" || item.source.kind === "reasoning_unavailable") return <div class="caption muted" data-thinking-marker="">{t("work.thinking")}</div>;
      if (item.source.kind === "interruption") return <Notice>{t("status.stopped")}</Notice>;
      if (item.source.kind === "record") return <details data-internal-records=""><summary>{t("work.records", {n: 1})}</summary><span class="caption muted">{t("work.textUnavailable")}</span></details>;
      if (item.source.kind === "unknown" || item.source.kind === "unavailable") return <div class="caption muted" data-item-unavailable="">{item.source.kind === "unknown" ? t("work.record") : t("work.textUnavailable")}{item.source.kind === "unavailable" && item.source.reason ? ` (${item.source.reason})` : ""}</div>;
      return null;
    }} />;
}

/** A typed deferred node is a placeholder, not authority to show its aggregate. */
export function DeferredHistoryNode({ model, row }: { model: AppModel; row: HistoryItem }) {
  return <div class="caption muted" data-node={row.node_id} data-items-unavailable-reason={row.items_unavailable_reason}>
    {model.t.value("work.textUnavailable")}
  </div>;
}

/** Only records read from the current owned ledger may enter this adapter. */
export function projectOwnedHandoffFacts(scope: string, records: readonly HandoffRecord[]): readonly NormalizedSavedItem[] {
  return records.map(record => record.nodeId === undefined && record.proof === undefined && record.transferred !== true && record.status !== "ready" && record.text
    ? {domain: "live", namespace: "handoff", scope, recordId: record.key, kind: "text", text: record.text}
    : {domain: "live", namespace: "handoff", scope, recordId: record.key, kind: "unknown"});
}

/** One producer classifies saved facts and explicitly scoped live records. */
export function SavedWindowContent({ model, snapshot, live, liveBoundary, liveFacts }: { model: AppModel; snapshot: WindowAcceptedSnapshot; live?: ComponentChildren; liveBoundary?: number; liveFacts?: readonly NormalizedSavedItem[] }) {
  if (snapshot.revision === undefined) return null;
  const mapped = projectHistoryWindowItems({ revision: snapshot.revision, nodes: snapshot.rows });
  const handle = model.handle.value;
  const records = liveFacts ?? (handle ? normalizeLiveWorkFacts({scope: handle.threadId, items: handle.work.value.value?.items ?? []}) : []);
  const handoffs = handle ? projectOwnedHandoffFacts(handle.threadId, handle.handoff.value) : [];
  const saved = mapped.projection.items.map(item => item.source);
  // This is the captured history cut, not an ordinal assigned to a live record.
  const cut = liveBoundary === undefined ? -1 : saved.findIndex(source => {
    const node = snapshot.rows.find(node => node.node_id === source.nodeId);
    return node?.selection?.ordinal !== undefined && node.selection.ordinal >= liveBoundary;
  });
  const ordered = cut < 0 ? [...saved, ...handoffs] : [...saved.slice(0, cut), ...handoffs, ...saved.slice(cut)];
  const projection = projectSavedItems([...ordered, ...records]);
  // Live text without item-kind proof cannot unlock or replace saved Conversation text.
  return <SavedConversationItems model={model} projection={projection} nodes={snapshot.rows} />;
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

function ConversationStatus({ model }: { model: AppModel }) {
  const t = model.t.value;
  const work = model.work.value;
  const row = model.selectedRow.value;
  const status = model.threadReplies.value.some((r) => r.recipient.kind === "human") ? "awaiting" : row?.status;
  if (!status) return null;
  const running = work.running[0];
  const start = running?.startedAt ? parseTime(running.startedAt) : undefined;
  return <div class="work-row conversation-status" role="status"><img class="character-status" src={characterAssets[statusCharacter(status)]} alt="" /><span>{status === "running" && row?.summary.activity ? activityLabel(model.lang.value, row.summary.activity) : statusLabel(t, status)}</span>
    {running ? <span>{running.label} {work.running.length > 1 ? t("work.runningCount", { n: work.running.length }) : ""} {start === undefined ? "" : formatDuration(model.now.value - start)}</span> : null}
    {status === "recovery" ? <><span>{model.recovery.value?.message ?? model.recovery.value?.hint}</span>{model.canRetry.value ? <Button onClick={() => void model.retry()}>{t("action.retry")}</Button> : null}</> : null}
  </div>;
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

export function StepView({ model, step }: { model: AppModel; step: Step }) {
  const t = model.t.value;
  const choice = model.toolStepChoices.value.get(step.executionId);
  const open = choice ?? step.status === "running";
  useEffect(() => {
    if (!open) return;
    model.selectedStepId.value = step.executionId;
    return model.watchOutput(step.executionId);
  }, [model, open, step.executionId]);
  return (
    <StepRow
      anchorKey={step.executionId}
      open={open}
      command={step.description ?? step.command}
      status={step.status ? <StatusMark status={step.status} label={statusLabel(t, step.status)} /> : null}
      duration={stepDuration(step, model.now.value)}
      exit={exitText(step)}
      onToggle={(next) => {
        if (next !== open) model.toolStepChoices.value = new Map(model.toolStepChoices.peek()).set(step.executionId, next);
      }}
    >
      {step.description ? <div class="mono muted caption">{step.command}</div> : null}
      <Output model={model} id={step.executionId} command={step.command ?? ""} complete={step.status === "completed" || step.status === "failed"} />
    </StepRow>
  );
}

function RowView({ model, row, authorizedText }: { model: AppModel; row: ConversationRow; authorizedText?: string }) {
  const t = model.t.value;
  const threadId = model.handle.value?.threadId;
  const point = threadId !== undefined ? formatRoute({ view: "branches", threadId, nodeId: row.id }) : undefined;
  const found = model.rowMarks.value.get(row.id);
  const mark = found && threadId !== undefined ? <BranchMark href={formatRoute({ view: "branches", threadId, nodeId: found.nodeId })} label={found.branches === 1 ? t("branches.markOne") : t("branches.mark", { n: found.branches })} /> : null;
  if (row.type === "publication") return <div class="caption" role="status">
    {mark}
    <strong>{t(row.state === "tool" ? "convo.toolIdentity" : row.error ? "convo.publicationFailed" : "convo.publicationUnknown")}</strong>
    {row.kind ? <div><code>{row.kind}</code> <code>{row.attemptId}</code> / {row.ordinal}</div> : null}
    {row.state === "unknown" ? <Button onClick={() => void model.handle.value?.retryPublication()}>{t("convo.retryLoad")}</Button> : null}
  </div>;
  if (row.type === "steps") {
    const opened = model.openToolGroups.value.has(row.id) || row.steps.some((step) => model.openToolGroups.value.has(`step:${step.executionId}`));
    const active = row.steps.find((s) => s.status === "running");
    const nonzero = row.steps.filter((s) => typeof s.exitCode === "number" && s.exitCode !== 0).length;
    const failed = row.steps.some((s) => s.state === "failed" || s.status === "recovery" || (typeof s.exitCode === "number" && s.exitCode !== 0));
    const compacted = row.entries.filter((entry) => entry.kind === "compacted").length;
    const summary = [t("tools.count", { n: row.steps.length }), ...(compacted ? [t("tools.compacted", { n: compacted })] : []), ...(nonzero ? [t("tools.nonzero", { n: nonzero })] : []), ...(active ? [t("tools.active", { command: toolLabel(active.description, active.command) })] : [])].join(" · ");
    return (
      <>
        <section class="steps">
          <StepRow open={opened} command={summary} group status={<StatusMark status={active ? "running" : failed ? "failed" : "completed"} label={statusLabel(t, active ? "running" : failed ? "failed" : "completed")} />} onToggle={(open) => { const next = new Set(model.openToolGroups.peek()); for (const key of [row.id, ...row.steps.map((step) => `step:${step.executionId}`)]) { if (open) next.add(key); else next.delete(key); } model.openToolGroups.value = next; }}>
            <div class="step-group-list">{row.entries.map((entry) => entry.kind === "step" ? <StepView key={entry.step.executionId} model={model} step={entry.step} /> : <div class="step" key={entry.id}><div class="work-row"><Icon name="compacted" /><span>{t("compact.spill")}</span><span>{entry.text}</span></div></div>)}</div>
          </StepRow>
        </section>
        {mark ? <div class="scroll-mark">{mark}</div> : null}
      </>
    );
  }
  if (row.type === "note")
    return (
      <>
        <SummaryStrip label={row.kind === "spill" ? t("compact.spill") : row.kind} text={row.text} />
        {mark ? <div class="scroll-mark">{mark}</div> : null}
      </>
    );
  const who = row.speaker.kind === "you" ? t("convo.you") : row.speaker.kind === "shellboy" ? t("convo.shellboy") : row.speaker.kind === "cli" ? t("convo.cli") : row.speaker.kind === "model" ? t("convo.modelSender") : row.speaker.kind === "unknown" ? t(row.speaker.model ? "convo.unknownModelSender" : "convo.unknownSender") : row.speaker.label;
  const body = model.bodies.value.get(row.id);
  return (
    <Message bot={row.speaker.kind === "shellboy"} who={who} at={formatClock(row.at)} text={authorizedText ?? body?.text ?? row.text} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
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
            renderRow={(row) => visible(row) ? <RowView model={model} row={row} /> : <></>}
            renderAcceptedView={snapshot => <><SavedWindowContent model={model} snapshot={snapshot} liveBoundary={boundary?.ordinal} live={<LiveMessage model={model} handle={handle} follow={follow} />} /></>}
            live={<LiveMessage model={model} handle={handle} follow={follow} />}
            liveBoundary={boundary?.ordinal}
            statusLine={<ConversationStatus model={model} />}
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
            {[
              ...rows.flatMap((row, index) => [
                ...(index === boundary?.legacy ? [<LiveMessage key="handoff-slot" model={model} handle={handle} follow={follow} />] : []),
                <div class="conversation-row" key={row.id}>{visible(row) ? <RowView model={model} row={row} /> : null}</div>,
              ]),
              ...(boundary === undefined || boundary.legacy >= rows.length ? [<LiveMessage key="handoff-slot" model={model} handle={handle} follow={follow} />] : []),
            ]}
            <ConversationStatus model={model} />
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

  if (!handle)
    return (
      <div class="convo">
        <EmptyState icon="chat" title={t("convo.noThread")} body={t("convo.noThreadBody")}>
          <Button variant="primary" onClick={() => void model.createThread()}>{t("action.new")}</Button>
        </EmptyState>
      </div>
    );

  const send = model.sendState.value;
  const conn = model.connection.value;
  const recovery = model.recovery.value;
  const loading = !history?.loaded;

  return (
    <>
      <div class="convo">
        <OrderedHistory model={model} handle={handle} rows={rows} win={win} history={history} scroller={scroller} pinned={pinned} follow={follow} loading={loading} t={t} />
        <div class="dock">
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
            hint={t("composer.hint")}
            sendLabel={t("composer.send")}
            canSend={conn === "connected"}
            busy={send.kind === "sending"}
            onSend={(text) => model.send(text)}
            stop={
              model.canStop.value ? (
                <Button variant="stop" onClick={() => void model.stop()}>
                  <Icon name="square" small />
                  {t("composer.stop")}
                </Button>
              ) : undefined
            }
          />
        </div>
      </div>
      <Details model={model} />
      <WorkSheet open={sheetOpen} title={t("work.title")} closeLabel={t("work.close")} onClose={() => setSheetOpen(false)}><WorkRegions model={model} place="sheet" /></WorkSheet>
    </>
  );
}
