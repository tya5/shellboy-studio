import { expect, it } from "vitest";
import { ATTACHMENT_PAGE_SIZE, MAX_LIST_ROWS } from "../../data/src";
import { settle } from "../../data/test/harness";
import { fixtureModel } from "./fixture";

it("continues beyond 200 rows and shares the Thread list retention bound", async () => {
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
    for (let loaded = ATTACHMENT_PAGE_SIZE; loaded < MAX_LIST_ROWS; loaded += ATTACHMENT_PAGE_SIZE) {
      expect(section.state.peek()).toMatchObject({ cursor: String(loaded), capped: false });
      section.more();
      await settle(f.t, f.db);
    }
    expect(section.state.peek().items).toHaveLength(MAX_LIST_ROWS);
    expect(section.state.peek()).toMatchObject({ capped: true, complete: false });
    section.more();
    await settle(f.t, f.db);
    expect(f.t.calls("attachment.list")).toHaveLength(MAX_LIST_ROWS / ATTACHMENT_PAGE_SIZE);
  } finally { stop(); f.model.dispose(); f.data.stop(); }
});
