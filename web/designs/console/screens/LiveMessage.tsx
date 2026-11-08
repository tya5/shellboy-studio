import { useLayoutEffect, useRef } from "preact/hooks";
import type { ThreadHandle } from "../../../data/src";
import { CAPABILITY_LIVE_TEXT, type AppModel } from "../../../ui-core/src";
import { Message } from "../system/components";

/**
 * The unsaved text of the attempt being written. It reads the preview signal itself, so a burst
 * of text re-renders only this message, never the Conversation around it. The saved message
 * replaces it (the data layer drops the preview then).
 */
export function LiveMessage({ model, handle, follow }: { model: AppModel; handle: ThreadHandle; follow: (from: Element | null) => void }) {
  const t = model.t.value;
  const on = model.data.capabilities.value.includes(CAPABILITY_LIVE_TEXT);
  const preview = handle.preview.value;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => follow(box.current), [preview]);
  if (!on || preview.kind !== "live" || preview.text === "") return null;
  return (
    <div ref={box} class="conversation-row">
    <Message bot who={t("convo.shellboy")} at={t("convo.live")} text={preview.text} copyLabel={t("code.copy")} copiedLabel={t("code.copied")}>
      {preview.incomplete ? <div class="caption muted">{t("convo.liveIncomplete")}</div> : null}
    </Message>
    </div>
  );
}
