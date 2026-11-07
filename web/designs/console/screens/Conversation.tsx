import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatClock, formatDuration, formatRoute, formatTokens, parseTime, statusLabel, type AppModel, type ConversationRow, type StepRow as Step } from "../../../ui-core/src";
import { WindowedScroll } from "./WindowedScroll";
import { BranchMark, Button, Composer, LoadingRows, EmptyState, Icon, KeyValue, LogBlock, Message, Notice, StatusMark, StepRow, SummaryStrip } from "../system/components";

const stepDuration = (s: Step, now: number): string | undefined => {
  if (s.durationMs !== undefined) return formatDuration(s.durationMs);
  const start = parseTime(s.startedAt);
  return s.status === "running" && start !== undefined ? formatDuration(now - start) : undefined;
};

const exitText = (s: Step): string | undefined => (typeof s.exitCode === "number" ? `exit ${s.exitCode}` : undefined);

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
      command={step.command}
      status={step.status ? <StatusMark status={step.status} label={statusLabel(t, step.status)} /> : null}
      duration={stepDuration(step, model.now.value)}
      exit={exitText(step)}
      onToggle={(next) => {
        if (next !== open) setChoice(next);
      }}
    >
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
      <h3>{t("details.title")}</h3>
      {step ? (
        <>
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
        </>
      ) : (
        <div class="muted caption">{t("details.pick")}</div>
      )}
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
    </aside>
  );
}

export function Conversation({ model }: { model: AppModel }) {
  const t = model.t.value;
  const handle = model.handle.value;
  const rows = model.conversation.value;
  const win = model.longReader.value;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const history = handle?.history.value;
  const preview = handle?.preview.value;
  const previewText = preview?.kind === "live" ? preview.text : undefined;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows, previewText]);
  useEffect(() => {
    pinned.current = true;
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
            live={previewText !== undefined ? <Message bot who={t("convo.shellboy")} at={t("convo.live")} text={previewText} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} /> : null}
          />
        ) : (
          <div
            class="scroll"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            }}
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
            {previewText !== undefined ? (
              <Message bot who={t("convo.shellboy")} at={t("convo.live")} text={previewText} copyLabel={t("code.copy")} copiedLabel={t("code.copied")} />
            ) : null}
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
    </>
  );
}
