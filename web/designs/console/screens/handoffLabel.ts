import type { HandoffRecord } from "../../../data/src/handoff";
import type { HandoffRetryState } from "../../../data/src/store";
import type { MessageKey } from "../../../ui-core/src/i18n";

/** One typed phase/reason authority for retained live-response labels. */
export function handoffLabelKey(record: HandoffRecord, retry: HandoffRetryState | undefined): MessageKey {
  if (retry?.phase === "unavailable") return `convo.retry.${retry.reason}` as MessageKey;
  if (retry?.phase === "reading") return "convo.handoffConfirming";
  if (record.status === "streaming") return "convo.live";
  if (record.status === "ready") return "convo.handoffConfirming";
  if (record.status === "failed") return "convo.handoffFailed";
  return "convo.handoffConfirming";
}
