import {admitMessageProvenance} from "../../data/src/message-provenance";
import type { SenderTitle } from "./sender-titles";
import { formatRoute } from "./route";

export interface SenderHeaderDisplay {
  readonly label: string;
  readonly href: string;
  readonly sourceId: string;
  readonly fallbackId?: string;
}
/** Presentation only: title resolution never changes exact sender identity. */
export function senderHeaderDisplay(threadId: string, title: SenderTitle | undefined, genericLabel: string): SenderHeaderDisplay {
  const resolved = title?.state === "ready" && !!title.title?.trim();
  return Object.freeze({
    sourceId:threadId,
    label: resolved ? title!.title! : genericLabel,
    href: formatRoute({ view: "conversation", threadId }),
    fallbackId: resolved ? undefined : threadId.slice(0, 8),
  });
}

export type MessageRelationship = {kind:'unavailable'}|{kind:'ordinary'}|{kind:'reply';requestId:string}|{kind:'request';state:'pending'|'replied'|'ignored'|'cancelled';replyId?:string};
export function messageRelationship(value:unknown,nodeId?:string):MessageRelationship{
 const message=admitMessageProvenance(value,nodeId);
 if(!message)return {kind:'unavailable'};
 if(!message.expect_reply)return message.reply_to?{kind:'reply',requestId:message.reply_to}:{kind:'ordinary'};
 return {kind:'request',state:message.reply_state,replyId:message.reply_node_id};
}
