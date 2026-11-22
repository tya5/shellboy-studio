import { describe, expect, it } from "vitest";
import { decodeThreadReplies } from "../src/replies";

describe("thread reply projection", () => {
  it("distinguishes human and thread recipients and rejects invalid data", () => {
    const rows = decodeThreadReplies("source", [
      { message_id: "h", recipient_kind: "human", excerpt: "Question", delivery_status: "applied" },
      { message_id: "t", recipient_kind: "thread", recipient_thread_id: "target", excerpt: "Task", delivery_status: "applied" },
      { message_id: "bad", recipient_kind: "unknown", excerpt: "?", delivery_status: "applied" },
    ]);
    expect(rows?.complete).toBe(false);
    expect(rows?.items.map((r) => r.recipient)).toEqual([{ kind: "human" }, { kind: "thread", threadId: "target", title: "target" }]);
    expect(decodeThreadReplies("source", Array(18).fill({}))).toBeUndefined();
    expect(decodeThreadReplies("source", undefined)).toBeUndefined();
  });
  it.each([[16, true], [17, false]] as const)("decodes %i rows with complete=%s", (count, complete) => {
    const raw = Array.from({ length: count }, (_, i) => ({ message_id: `duty-${i}`, recipient_kind: "human", excerpt: "Question", delivery_status: "applied" }));
    const result = decodeThreadReplies("source", raw);
    expect(result?.items).toHaveLength(count);
    expect(result?.complete).toBe(complete);
  });
});
