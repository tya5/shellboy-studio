import { describe, expect, it } from "vitest";
import { flush, settle } from "../../data/test/harness";
import { fixtureModel } from "./fixture";

describe("the long-thread reader in the model", () => {
  it("with history.window reads by position and never lists the history", async () => {
    const { model, t } = await fixtureModel({ capabilities: ["history.window"] });
    expect(model.longReader.value).toBeDefined();
    expect(t.calls("history.window").length).toBeGreaterThan(0);
    expect(t.calls("history.list")).toHaveLength(0);
  });

  it("without it the reader stays off and history is unavailable without a legacy RPC", async () => {
    const { model, t } = await fixtureModel();
    expect(model.longReader.value).toBeUndefined();
    expect(t.calls("history.window")).toHaveLength(0);
    expect(t.calls("history.list")).toHaveLength(0);
  });

  it("leaving the Conversation ends the reader and its reads", async () => {
    const { model, t, db } = await fixtureModel({ capabilities: ["history.window"] });
    model.showView("monitor");
    await settle(t, db);
    expect(model.longReader.value).toBeUndefined();
    const sent = t.sent.length;
    t.push({ t: "changed", thread_ids: ["lead"], list: false });
    await flush();
    expect(t.sent.slice(sent).filter((f) => f.t === "call" && f.command === "history.window")).toHaveLength(0);
  });
});
