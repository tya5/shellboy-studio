import { expect, it } from "vitest";
import { ATTACHMENT_PAGE_SIZE } from "../../data/src";
import { settle } from "../../data/test/harness";
import { fixtureModel } from "./fixture";

it("continues beyond the old count cap and retries the same owner page under pressure", async () => {
  const f = await fixtureModel({ route: "conversation", threadId: "lead" });
  const answer = f.db.answer.bind(f.db);
  f.db.answer = call => {
    if (call.command !== "attachment.list") return answer(call);
    const start = Number((call.args as { cursor?: string }).cursor ?? 0);
    return { ok: true, result: {
      next_cursor: String(start + ATTACHMENT_PAGE_SIZE),
      items: Array.from({ length: ATTACHMENT_PAGE_SIZE }, (_, i) => ({
        attachment_id: `a${start + i}`, thread_id: "lead", source_node_id: `n${start + i}`,
        path: `/fixture/a${start + i}`, kind: "file", delivery_status: "applied", selected: true, managed: false,
      })),
    } };
  };
  const section = f.model.attachmentSection;
  const stop = section.observe("lead");
  try {
    await settle(f.t, f.db);
    const count = 1050; // Beyond the previous 1,000-row cap.
    for (let loaded = ATTACHMENT_PAGE_SIZE; loaded < count; loaded += ATTACHMENT_PAGE_SIZE) {
      expect(section.state.peek()).toMatchObject({ cursor: String(loaded), capped: false });
      section.more();
      await settle(f.t, f.db);
    }
    const previous = section.state.peek();
    expect(previous.items).toHaveLength(count);
    const budget = f.data.retainedBudget;
    budget.setLimit(budget.usage.peek().used);
    section.more();
    await settle(f.t, f.db);
    expect(section.state.peek()).toMatchObject({ items: previous.items, cursor: previous.cursor, capped: true, complete: false });
    budget.setLimit(64 * 1024 * 1024);
    section.more();
    await settle(f.t, f.db);
    expect(f.t.calls("attachment.list").slice(-2).map(call => call.args)).toEqual([expect.objectContaining({ cursor: previous.cursor }), expect.objectContaining({ cursor: previous.cursor })]);
    expect(section.state.peek()).toMatchObject({ cursor: String(count + ATTACHMENT_PAGE_SIZE), capped: false });
  } finally { stop(); f.model.dispose(); f.data.stop(); }
});
