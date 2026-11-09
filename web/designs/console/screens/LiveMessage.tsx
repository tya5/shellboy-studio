import { useLayoutEffect, useRef } from "preact/hooks";
import type { ThreadHandle } from "../../../data/src";
import { CAPABILITY_LIVE_TEXT, type AppModel } from "../../../ui-core/src";
import { Button, Message } from "../system/components";

/**
 * The unsaved text of the attempt being written. It reads the preview signal itself, so a burst
 * of text re-renders only this message, never the Conversation around it. The saved message
 * replaces it (the data layer drops the preview then).
 */
export function LiveMessage({ model, handle, follow }: { model: AppModel; handle: ThreadHandle; follow: (from: Element | null) => void }) {
  const t = model.t.value;
  const on = model.data.capabilities.value.includes(CAPABILITY_LIVE_TEXT);
  const records = handle.handoff.value;
  const overflow = handle.handoffOverflow.value;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => follow(box.current), [records]);
  if (!on) return null;
  return <div ref={box}>
    {records.map(record => <div class="conversation-row" key={record.key} data-handoff-key={record.key}>
      <Message bot who={t("convo.shellboy")} at={record.status === "streaming" ? t("convo.live") : record.status === "ready" ? "" : record.status === "failed" ? t("convo.handoffFailed") : t("convo.handoffConfirming")} text={record.text} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
        {record.incomplete ? <div class="caption muted">{t("convo.liveIncomplete")}</div> : null}
        {record.status === "failed" || record.status === "confirming" ? <Button onClick={() => void handle.retryHandoff()}>{t("convo.retryLoad")}</Button> : null}
      </Message>
    </div>)}
    {overflow ? <div class="caption muted" role="status">{t("convo.handoffLimit")} <Button onClick={() => void handle.retryHandoff()}>{t("convo.retryLoad")}</Button></div> : null}
  </div>;
}
