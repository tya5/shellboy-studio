// Stop, recovery, branch marks and the selected step on the long-thread reader, after scrolling away from the end.
import { describe, expect, it } from "vitest";
import { flush, settle } from "../../data/test/harness";
import { fixtureModel } from "./fixture";
import { WindowOwner } from "./window-owner";

async function open(thread: string) {
  const owner = new WindowOwner(5000);
  owner.decorate = (i, item) =>
    i === 4990 ? { ...item, kind: "assistant_response", execution_count: 1, executions: [{ execution_id: "ex-far", command_excerpt: "make", state: "exited" }] } : item;
  const r = await fixtureModel({
    capabilities: ["history.window"],
    configure: (db) => {
      const base = db.answer.bind(db);
      db.answer = (c) => (c.command === "history.window" ? owner.answer(c) : base(c));
    },
  });
  if (thread !== "lead") {
    r.model.openThread(thread);
    await settle(r.t, r.db).catch(() => undefined);
  }
  const w = r.model.longReader.value!;
  const goTo = async (ordinal: number) => {
    while (ordinal < (w.renderRange()?.first ?? 0)) {
      w.view(0, 600, false);
      await new Promise((res) => setTimeout(res, 90));
      await settle(r.t, r.db).catch(() => undefined);
      const range = w.renderRange()!;
      w.measure(Array.from({ length: range.last - range.first + 1 }, (_, i) => [range.first + i, 40] as [number, number]));
    }
    if (ordinal > (w.renderRange()?.last ?? 0)) {
      w.jumpToEnd();
      await settle(r.t, r.db).catch(() => undefined);
    }
    w.view(w.offsetOf(ordinal), 600, false);
    await flush();
  };
  return { ...r, w, goTo };
}

describe("the reader keeps Stop, recovery, marks and steps working", () => {
  it("Stop does not depend on which window is held", async () => {
    const { model, goTo } = await open("lead");
    expect(model.canStop.value).toBe(true);
    await goTo(3200);
    expect(model.canStop.value).toBe(true);
  });

  it("recovery and retry show for a Thread in recovery after scrolling away", async () => {
    const { model, goTo, w } = await open("broken");
    expect(model.recovery.value).toBeDefined();
    expect(model.canRetry.value).toBe(true);
    await goTo(3200);
    expect(w.renderRange()!.last).toBeLessThan(4900); // the end is out of view
    expect(model.recovery.value?.message).toContain("connection interrupted");
    expect(model.canRetry.value).toBe(true);
  });

  it("branch marks follow the windows in view", async () => {
    const { model, goTo, w } = await open("lead");
    await goTo(4990);
    model.marks.value = new Map([["n0-4995", 2]]);
    expect(w.isLoaded(4995)).toBe(true);
    expect(model.rowMarks.value.get("n0-4995")).toEqual({ nodeId: "n0-4995", branches: 2 });
    await goTo(3200);
    expect(model.rowMarks.value.size).toBe(0);
    await goTo(4995);
    expect(w.renderRange()).toEqual({ first: 4900, last: 4999 });
    expect(w.isLoaded(4995)).toBe(true);
    expect(model.marks.value.get("n0-4995")).toBe(2);
    expect(model.rowMarks.value.get("n0-4995")).toEqual({ nodeId: "n0-4995", branches: 2 });
  });

  it("a mark on a hidden node goes to the row before it", async () => {
    const { model, goTo } = await open("lead");
    await goTo(4990);
    model.marks.value = new Map([["n0-4994", 1]]); // 4994 % 7 === 3: an event, no row of its own
    expect(model.rowMarks.value.get("n0-4993")).toEqual({ nodeId: "n0-4994", branches: 1 });
  });

  it("the selected step is found while its window is held, and not walked for", async () => {
    const { model, goTo, t } = await open("lead");
    model.selectedStepId.value = "ex-far";
    expect(model.selectedStep.value?.command).toBe("make");
    await goTo(4500);
    expect(model.selectedStep.value?.command).toBe("make"); // still held (16 windows)
    await goTo(3200);
    expect(model.selectedStep.value).toBeUndefined();
    expect(t.calls("history.list")).toHaveLength(0);
  });
});
