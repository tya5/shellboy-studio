import type { ComponentChildren } from "preact";
import type { SavedItemProjection } from "../../../ui-core/src/conversation-items";
import { ConversationItems, type ConversationItem, type ConversationToolSummary } from "./ConversationItems";
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

function RowView({ model, row }: { model: AppModel; row: ConversationRow }) {
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
    <Message bot={row.speaker.kind === "shellboy"} who={who} at={formatClock(row.at)} text={body?.text ?? row.text} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
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
