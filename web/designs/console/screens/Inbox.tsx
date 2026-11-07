import { useState } from "preact/hooks";
import { errorMessage, formatAge, formatRoute, statusLabel, STATUS_KEYS, type AppModel } from "../../../ui-core/src";
import { EmptyState, Icon, QuestionCard, QuestionItem, StatusMark } from "../system/components";

export function Inbox({ model }: { model: AppModel }) {
  const t = model.t.value;
  const items = model.pending.items.value;
  const counts = model.counts.value;
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const current = items.find((p) => p.id === picked) ?? items[0];
  const others = STATUS_KEYS.filter((k) => k !== "awaiting" && (counts[k] ?? 0) > 0);
  return (
    <div class="inbox">
      <div class="qlist">
        <h2>{t("view.inbox")}{items.length > 0 ? ` ${items.length}` : ""}</h2>
        {items.map((p) => (
          <QuestionItem key={p.id} title={p.threadTitle} age={formatAge(p.askedAt, model.now.value)} question={p.question} current={p.id === current?.id} onClick={() => setPicked(p.id)} />
        ))}
        {others.length > 0 ? (
          <div class="other">
            <h2>{t("inbox.other")}</h2>
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
            id={current.id}
            label={t("inbox.waitingLabel")}
            waitingWord={statusLabel(t, "awaiting")}
            question={current.question}
            answerLabel={t("inbox.answer")}
            submitLabel={t("inbox.answerResume")}
            error={error}
            onAnswer={(text) => {
              void model.pending.answer(current.id, text).then((out) => {
                setError(out.ok ? undefined : t("inbox.answerFailed", { message: errorMessage(out.error) }));
              });
            }}
            extra={
              <a class="btn" href={formatRoute({ view: "conversation", threadId: current.threadId })}>
                {t("monitor.open")}
                <Icon name="arrow" small />
              </a>
            }
          />
        ) : (
          <EmptyState icon="inbox" title={t("inbox.emptyTitle")} body={t("inbox.emptyBody")} />
        )}
      </div>
    </div>
  );
}
