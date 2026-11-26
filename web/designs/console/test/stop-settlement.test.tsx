// @vitest-environment happy-dom
// Core #431: a saved stop settlement failure on the stopping Run (run.get) is one supporting line
// under the existing conversation status. Only the typed value is shown; nothing is inferred.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { settle, summary } from "../../../data/test/harness";
import type { DesignContext, Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

async function open(failure: unknown, runState = "stopping") {
  const f = await fixtureModel({ route: "conversation", threadId: "stopping", configure(db) {
    db.threads.stopping = summary("stopping", { state: "stopping", activity: "stopping" });
    db.work.stopping = [{ kind: "run", id: "run-s", thread_id: "stopping", run_id: "run-s", state: "stopping" }];
    const base = db.answer.bind(db);
    db.answer = call => call.command === "run.get"
      ? { ok: true, result: { run_id: "run-s", thread_id: "stopping", state: runState, owned_execution_ids: [], context: {}, ...(failure === undefined ? {} : { stop_settlement_failure: failure }) } }
      : base(call);
  } });
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
  const context: DesignContext = { model: f.model, designs: DESIGNS, prefs, setPrefs(change) { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => { render(<App context={context} />, host!); await settle(f.t, f.db); });
  return f;
}

it("shows a saved storage failure for the stopping Run under the status line", async () => {
  const f = await open("storage");
  try {
    expect(f.t.calls("run.get").map(call => call.args)).toEqual([{ run_id: "run-s" }]);
    const line = host!.querySelector<HTMLElement>("[data-stop-settlement-failure]")!;
    expect(line.getAttribute("data-stop-settlement-failure")).toBe("storage");
    expect(line.textContent).toBe("Stop not confirmed for Run run-s: Core could not save it. Check free space and permissions of the data directory, then stop again.");
    expect(line.closest(".conversation-status")).toBeNull();
  } finally { f.model.dispose(); f.data.stop(); }
});

it("shows an invariant failure with its own wording", async () => {
  const f = await open("invariant");
  try {
    expect(host!.querySelector("[data-stop-settlement-failure]")?.getAttribute("data-stop-settlement-failure")).toBe("invariant");
  } finally { f.model.dispose(); f.data.stop(); }
});

it.each([
  ["no saved failure", undefined, "stopping"],
  ["a null failure", null, "stopping"],
  ["an unknown failure value", "disk", "stopping"],
  ["a Run that is no longer stopping", "storage", "stopped"],
])("shows nothing for %s", async (_name, failure, runState) => {
  const f = await open(failure, runState);
  try {
    expect(f.t.calls("run.get")).toHaveLength(1);
    expect(host!.querySelector("[data-stop-settlement-failure]")).toBeNull();
  } finally { f.model.dispose(); f.data.stop(); }
});

it("reads no Run when no Run is stopping", async () => {
  const f = await fixtureModel({ route: "conversation", threadId: "lead" });
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
  const context: DesignContext = { model: f.model, designs: DESIGNS, prefs, setPrefs(change) { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  host = document.createElement("div");
  document.body.append(host);
  try {
    await act(async () => { render(<App context={context} />, host!); await settle(f.t, f.db); });
    expect(f.t.calls("status").length).toBeGreaterThan(0);
    expect(f.t.calls("run.get")).toHaveLength(0);
  } finally { f.model.dispose(); f.data.stop(); }
});
