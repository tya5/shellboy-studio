import { describe, expect, it } from "vitest";
import { threadReplyItems } from "../src/replies";

describe("thread reply projection", () => {
  it("distinguishes human and thread recipients and rejects invalid data", () => {
    const rows = threadReplyItems("source", [
      { message_id: "h", recipient_kind: "human", excerpt: "Question", delivery_status: "applied" },
      { message_id: "t", recipient_kind: "thread", recipient_thread_id: "target", excerpt: "Task", delivery_status: "applied" },
      { message_id: "bad", recipient_kind: "unknown", excerpt: "?", delivery_status: "applied" },
    ]);
    expect(rows.map((r) => r.recipient)).toEqual([{ kind: "human" }, { kind: "thread", threadId: "target", title: "target" }]);
    expect(threadReplyItems("source", Array(129).fill({}))).toEqual([]);
    expect(threadReplyItems("source", undefined)).toEqual([]);
  });
});
