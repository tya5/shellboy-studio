import { effect } from "@preact/signals-core";
import { useEffect, useState } from "preact/hooks";
import type { ThreadHandle } from "../../../data/src/store";
import { savedAttemptIds } from "../../../ui-core/src/conversation-input";
import type { Translate } from "../../../ui-core/src/i18n";
import type { ConversationWindow } from "../../../ui-core/src/window";

type Notice = { key: string; kind: "convo.replyArriving" | "convo.replySaved" };

export function ReplyAnnouncement({ handle, win, t }: { handle: ThreadHandle; win: ConversationWindow; t: Translate }) {
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  useEffect(() => {
    let epoch = handle.liveEpochSignal.peek();
    let started = new Set<string>();
    let newest = -1;
    setNotices([]);
    const sync = () => {
      const records = handle.handoff.value;
      const currentEpoch = handle.liveEpochSignal.value;
      if (epoch !== currentEpoch) {
        epoch = currentEpoch;
        started = new Set();
        newest = -1;
        setNotices([]);
      }
      const snapshot = win.acceptedView.peek();
      if (!win.acceptedView.isCurrent(snapshot)) return;
      const saved = savedAttemptIds(snapshot.rows);
      const next: Notice[] = [];
      const held = new Set(records.map(record => record.attemptId));
      for (const id of started) {
        if (saved.has(id)) next.push({ key: `saved:${id}`, kind: "convo.replySaved" });
        if (!held.has(id) || saved.has(id)) started.delete(id);
      }
      for (const record of records) {
        if (!record.text || record.clientOrdinal <= newest || saved.has(record.attemptId)) continue;
        newest = record.clientOrdinal;
        started.add(record.attemptId);
        next.push({ key: `arriving:${record.attemptId}`, kind: "convo.replyArriving" });
      }
      if (next.length) setNotices(next);
    };
    const stop = effect(sync);
    const unsubscribe = win.acceptedView.subscribe(sync);
    return () => { stop(); unsubscribe(); };
  }, [handle, win]);
  return <span class="conversation-announcement" data-reply-announcement role="status" aria-live="polite" aria-atomic="true">
    {notices.map(entry => <span key={entry.key}>{t(entry.kind)}{" "}</span>)}
  </span>;
}
