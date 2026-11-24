import { describe, expect, it } from "vitest";
import { checkTag } from "../src";
import { fixtureModel } from "./fixture";
import { settle } from "../../data/test/harness";

describe("single-Thread tag editing", () => {
  it("validates the owner tag rule", () => {
    expect(checkTag(" bug hunt ")).toEqual({ ok: true, tag: "bug hunt" });
    expect(checkTag(" ")).toEqual({ ok: false, invalid: "empty" });
    expect(checkTag("a".repeat(129))).toEqual({ ok: false, invalid: "long" });
    expect(checkTag("x\ny")).toEqual({ ok: false, invalid: "chars" });
  });

  it("applies one Thread's tag changes without an organizer read", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["thread.tags"] });
    try {
      model.threadActions.openTagsFor("lead");
      model.threadActions.addTag(" urgent ");
      const write = model.threadActions.applyTags();
      await settle(t, db);
      await write;
      expect(t.calls("thread.tag").at(-1)?.args).toEqual({ thread_ids: ["lead"], add: ["urgent"] });
      expect(t.calls("thread.list").filter(call => (call.args as { limit?: number }).limit === 200)).toHaveLength(0);
    } finally { model.dispose(); }
  });
});
