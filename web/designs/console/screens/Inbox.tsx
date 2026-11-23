import { useRef, useState } from "preact/hooks";
import { errorMessage, formatAge, formatRoute, statusLabel, STATUS_KEYS, type AppModel } from "../../../ui-core/src";
import { Button, EmptyState, Icon, PageHeader, QuestionCard, QuestionItem, StatusMark } from "../system/components";

export function Inbox({ model }: { model: AppModel }) {
  const t = model.t.value;
  const items = model.pending.items.value;
  const counts = model.counts.value;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const [busy, setBusy] = useState<string>();
  const running = useRef<string | undefined>(undefined);
  const previous = useRef<string | undefined>(undefined);
  const current = items.find((p) => p.id === picked) ?? items.find(p => p.id === previous.current) ?? items[0];
  previous.current = current?.id;
  const actOn = async (id: string, operation: () => ReturnType<typeof model.pending.answer>, kind: "inbox.answerFailed" | "work.cancelFailed") => {
    if (running.current !== undefined) return;
    running.current = id;
    setBusy(id);
    setFailure(undefined);
    try {
      const out = await operation();
      if (!out.ok) setFailure({ id, message: t(kind, { message: errorMessage(out.error) }) });
    } finally { running.current = undefined; setBusy(undefined); }
  };
  const others = STATUS_KEYS.filter((k) => k !== "awaiting" && (counts[k] ?? 0) > 0);
  return (
    <div class="inbox">
      <PageHeader title={t("view.inbox")} />
      <div class="qlist">
        <h2 class="group-label">{t("inbox.questions")}{items.length > 0 ? ` ${items.length}` : ""}</h2>
        {items.map((p) => {
          const row = model.rowById.value.get(p.threadId)?.summary;
          const count = row?.awaiting_named_count;
          const title = `${row?.title ?? p.threadId}${count !== undefined ? ` (${count}${row?.awaiting_named_count_exact === false ? "+" : ""})` : ""}`;
          return <QuestionItem key={p.id} title={title} age={formatAge(p.askedAt, model.now.value)} question={p.question} current={p.id === current?.id} onClick={() => setPicked(p.id)} />;
        })}
        {model.pending.loading?.value ? <p class="muted caption" role="status">{t("common.loading")}</p> : null}
        {model.pending.stale?.value ? <p class="muted caption">{t("work.stale")}</p> : null}
        {model.pending.error?.value ? <p role="alert">{errorMessage(model.pending.error.value)}</p> : null}
        {model.pending.hasMore?.value ? <Button variant="ghost" onClick={() => void model.pending.more?.()}>{t("threads.more")}</Button> : null}
        {others.length > 0 ? (
          <div class="other">
            <h2 class="group-label">{t("inbox.other")}</h2>
            {others.map((k) => (
              <div key={k}>
                <StatusMark status={k} label={statusLabel(t, k)} />
                <span class="mono">{counts[k]}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div class="qdetail">
        {current ? (
          <QuestionCard
            key={current.id}
            id={current.id}
            label={t("inbox.waitingLabel")}
            waitingWord={statusLabel(t, "awaiting")}
            question={current.question}
            answerLabel={t("inbox.answer")}
            submitLabel={t("inbox.answerResume")}
            error={failure?.id === current.id ? failure.message : undefined}
            busy={busy !== undefined}
            onAnswer={(text) => { void actOn(current.id, () => model.pending.answer(current.id, text), "inbox.answerFailed"); }}
            extra={<>
              {model.pending.cancel ? <Button variant="ghost" disabled={busy !== undefined} onClick={() => void actOn(current.id, () => model.pending.cancel!(current.id), "work.cancelFailed")}>{t("work.cancel")}</Button> : null}
              <a class="nav-link" href={formatRoute({ view: "conversation", threadId: current.threadId })}>
                {t("monitor.open")}
                <Icon role="inbox.openConversation" size="small" />
              </a>
            </>}
          />
        ) : model.pending.error?.value || model.pending.loading?.value || model.pending.stale?.value ? null : (
          <EmptyState role="empty.inbox" title={t("inbox.emptyTitle")} body={t("inbox.emptyBody")} />
        )}
      </div>
    </div>
  );
}
