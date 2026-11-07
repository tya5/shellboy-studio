import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatClock, formatDuration, formatRoute, formatTokens, parseTime, statusLabel, type AppModel, type ConversationRow, type StepRow as Step } from "../../../ui-core/src";
import { ScrollIntent } from "./scrollIntent";
import { LiveMessage } from "./LiveMessage";
import { WindowedScroll } from "./WindowedScroll";
import { BranchMark, Button, Composer, LoadingRows, EmptyState, Icon, KeyValue, LogBlock, Message, Notice, QuestionCard, StatusMark, StepRow, SummaryStrip, WorkSheet } from "../system/components";

const stepDuration = (s: Step, now: number): string | undefined => {
  if (s.durationMs !== undefined) return formatDuration(s.durationMs);
  const start = parseTime(s.startedAt);
  return s.status === "running" && start !== undefined ? formatDuration(now - start) : undefined;
};

const exitText = (s: Step): string | undefined => (typeof s.exitCode === "number" ? `exit ${s.exitCode}` : undefined);

function ConversationStatus({ model }: { model: AppModel }) {
  const t = model.t.value;
  const work = model.work.value;
  const row = model.selectedRow.value;
  const status = model.threadReplies.value.some((r) => r.recipient.kind === "human") ? "awaiting" : row?.status;
  if (!status || status === "idle" || status === "completed" || status === "failed") return null;
  const running = work.running[0];
  const start = running?.startedAt ? parseTime(running.startedAt) : undefined;
  return <div class="work-row" role="status"><StatusMark status={status} label={statusLabel(t, status)} />
    {running ? <span>{running.label} {work.running.length > 1 ? t("work.runningCount", { n: work.running.length }) : ""} {start === undefined ? "" : formatDuration(model.now.value - start)}</span> : null}
    {status === "recovery" ? <><span>{model.recovery.value?.message ?? model.recovery.value?.hint}</span>{model.canRetry.value ? <Button onClick={() => void model.retry()}>{t("action.retry")}</Button> : null}</> : null}
  </div>;
}

function Output({ model, id, boxed }: { model: AppModel; id: string; boxed?: boolean }) {
  const t = model.t.value;
  const out = model.outputs.value.get(id);
  if (!out || (out.loading && out.text === "")) return <div class="log muted">{t("details.outputLoading")}</div>;
  if (out.error) return <div class="log muted">{t("details.outputError", { message: out.error })}</div>;
  return (
    <>
      <LogBlock text={out.text === "" ? t("details.outputEmpty") : out.text} boxed={boxed ?? false} />
      {out.cutOff ? <div class="caption muted">{t("details.outputMore")}</div> : null}
    </>
  );
}

function StepView({ model, step }: { model: AppModel; step: Step }) {
  const t = model.t.value;
  const [choice, setChoice] = useState<boolean | undefined>(undefined);
  const open = choice ?? step.status === "running";
  useEffect(() => {
    if (!open) return;
    model.selectedStepId.value = step.executionId;
    return model.watchOutput(step.executionId);
  }, [model, open, step.executionId]);
  return (
    <StepRow
      open={open}
      command={step.description ?? step.command}
      status={step.status ? <StatusMark status={step.status} label={statusLabel(t, step.status)} /> : null}
      duration={stepDuration(step, model.now.value)}
      exit={exitText(step)}
      onToggle={(next) => {
        if (next !== open) setChoice(next);
      }}
    >
      {step.description ? <div class="mono muted caption">{step.command}</div> : null}
      <Output model={model} id={step.executionId} />
    </StepRow>
  );
}

function RowView({ model, row }: { model: AppModel; row: ConversationRow }) {
  const t = model.t.value;
  const threadId = model.handle.value?.threadId;
  const point = threadId !== undefined ? formatRoute({ view: "branches", threadId, nodeId: row.id }) : undefined;
  const found = model.rowMarks.value.get(row.id);
  const mark = found && threadId !== undefined ? <BranchMark href={formatRoute({ view: "branches", threadId, nodeId: found.nodeId })} label={found.branches === 1 ? t("branches.markOne") : t("branches.mark", { n: found.branches })} /> : null;
  if (row.type === "steps")
    return (
      <>
        <div class="steps">
          {row.steps.map((s) => (
            <StepView key={s.executionId} model={model} step={s} />
          ))}
        </div>
        {mark ? <div class="scroll-mark">{mark}</div> : null}
      </>
    );
  if (row.type === "note")
    return (
      <>
        <SummaryStrip label={row.kind} text={row.text} />
        {mark ? <div class="scroll-mark">{mark}</div> : null}
      </>
    );
  const who = row.speaker.kind === "you" ? t("convo.you") : row.speaker.kind === "shellboy" ? t("convo.shellboy") : row.speaker.kind === "cli" ? t("convo.cli") : row.speaker.label;
  const body = model.bodies.value.get(row.id);
  return (
    <Message bot={row.speaker.kind === "shellboy"} who={who} at={formatClock(row.at)} text={body?.text ?? row.text} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
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
      <div class="work-row" key={r.id}><span>{r.question}</span><span>{r.state}</span><a href={formatRoute({ view: "conversation", threadId: r.recipient.threadId })}>{r.recipient.title}</a></div>)}</section> : null}
    {work.running.length ? <section class="work-region"><h3>{t("work.running")}</h3><span class="caption muted">{t("work.incomplete")}</span>{work.running.map((r) => <div class="work-row" key={r.id}><span class="mono">{r.label}</span><span>{state(r.state)} {r.startedAt && parseTime(r.startedAt) !== undefined ? formatDuration(model.now.value - parseTime(r.startedAt)!) : ""}</span></div>)}</section> : null}
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
          <Output model={model} id={step.executionId} boxed />
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
              { key: t("details.children"), value: details.children_count, mono: true },
            ]}
          />
        </>
      ) : null}
        </section>
      ) : null}
    </aside>
  );
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
  // Keep the bottom in view while following, on either reader. The live message passes itself
  // so the scroll box is found from it (the windowed reader owns its box).
  const follow = (from?: Element | null) => {
    const el = from?.closest<HTMLElement>(".scroll") ?? scroller.current;
    if (el && (win ? win.following.peek() : pinned.current.following)) pinned.current.program(el, el.scrollHeight);
  };

  useLayoutEffect(() => follow(), [rows]);
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
        {win ? (
          <WindowedScroll
            model={model}
            win={win}
            renderRow={(row) => <RowView model={model} row={row} />}
            live={<><LiveMessage model={model} handle={handle} follow={follow} /><ConversationStatus model={model} /></>}
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
                  <Button disabled={history.loadingMore} onClick={() => void handle.loadOlderHistory()}>{t("convo.earlier")}</Button>
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
            {rows.map((row) => (
              <RowView key={row.id} model={model} row={row} />
            ))}
            <LiveMessage model={model} handle={handle} follow={follow} />
            <ConversationStatus model={model} />
            {rows.length === 0 && !history?.error ? (
              loading ? <LoadingRows label={t("convo.loading")} rows={5} /> : <EmptyState icon="chat" title={t("convo.empty")} body={t("convo.emptyBody")} />
            ) : null}
          </div>
        )}
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
