// @vitest-environment happy-dom
// Core #431: a saved stop settlement failure on the stopping Run (run.get) is one supporting line
// under the existing conversation status. Only the typed value is shown; nothing is inferred.
import "@preact/signals";
import { signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { settle, summary, type FakeOwnerDb } from "../../../data/test/harness";
import type { DesignContext, Prefs } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

/** The owner's saved Run, changed between hints the way Core records and settles a stop. */
interface SavedRun { state: string; failure?: unknown }

async function open(run: SavedRun) {
  const f = await fixtureModel({ route: "conversation", threadId: "stopping", configure(db) {
    db.threads.stopping = summary("stopping", { state: "stopping", activity: "stopping" });
    db.details.stopping = { ...db.details.stopping!, run_id: "run-s" };
    db.work.stopping = [{ kind: "run", id: "run-s", thread_id: "stopping", run_id: "run-s", state: "stopping" }];
    const base = db.answer.bind(db);
    db.answer = call => call.command === "run.get"
      ? { ok: true, result: { run_id: "run-s", thread_id: "stopping", state: run.state, owned_execution_ids: [], context: {}, ...(run.failure === undefined ? {} : { stop_settlement_failure: run.failure }) } }
      : base(call);
  } });
  const prefs = signal<Prefs>({ design: "console", theme: "console", lang: "en", weights: { cached: 0.1, output: 5 } });
  const context: DesignContext = { model: f.model, designs: DESIGNS, prefs, setPrefs(change) { prefs.value = { ...prefs.value, ...change }; }, submitToken: async () => true };
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => { render(<App context={context} />, host!); await settle(f.t, f.db); });
  return f;
}

/** The owner's ordinary changed hint for this Thread; no other read trigger. */
async function hint(f: { t: Parameters<typeof settle>[0]; db: FakeOwnerDb }) {
  await act(async () => { f.t.push({ t: "changed", config_changed: false, thread_ids: ["stopping"], list: false }); await settle(f.t, f.db); });
}

const line = () => host!.querySelector<HTMLElement>("[data-stop-settlement-failure]");

it("appears for the named Run on the owner's hint and clears when the owner reports settlement", async () => {
  const run: SavedRun = { state: "stopping" };
  const f = await open(run);
  try {
    expect(f.t.calls("run.get").map(call => call.args)).toEqual([{ run_id: "run-s" }]);
    expect(line()).toBeNull();
    run.failure = "storage";
    await hint(f);
    expect(line()?.getAttribute("data-stop-settlement-failure")).toBe("storage");
    expect(line()?.getAttribute("data-stop-settlement-run")).toBe("run-s");
    expect(line()?.textContent).toContain("Stop not confirmed for Run run-s: Core could not save it. Check free space and permissions on the data directory. Once that is fixed, if this Run is still stopping, stop it again.");
    expect(line()?.closest(".conversation-status")).toBeNull();
    expect(f.t.calls("run.stop")).toHaveLength(0);
    run.state = "stopped"; delete run.failure;
    f.db.threads.stopping = summary("stopping", { state: "idle", activity: "stopped" });
    f.db.work.stopping = [];
    await hint(f);
    expect(line()).toBeNull();
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { f.model.dispose(); f.data.stop(); }
});

it("shows the invariant guidance as information only", async () => {
  const f = await open({ state: "stopping", failure: "invariant" });
  try {
    expect(line()?.getAttribute("data-stop-settlement-failure")).toBe("invariant");
    expect(line()?.textContent).toBe("Stop not confirmed for Run run-s: Core found an inconsistent state. Note the Run ID and check Core diagnostics. Once the cause is addressed, if this Run is still stopping, stop it again.");
    expect(line()?.querySelector("button")).toBeNull();
  } finally { f.model.dispose(); f.data.stop(); }
});

it.each([
  ["a null failure", null, "stopping"],
  ["an unknown failure value", "disk", "stopping"],
  ["a Run that is no longer stopping", "storage", "stopped"],
])("shows nothing for %s", async (_name, failure, state) => {
  const f = await open({ state, failure });
  try {
    expect(f.t.calls("run.get")).toHaveLength(1);
    expect(line()).toBeNull();
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
