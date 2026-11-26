// @vitest-environment happy-dom
// Core #431 / #444: a saved stop settlement failure on the Thread's Run, read from that Run's status
// work row, is one supporting line under the existing conversation status. Only the typed value is
// shown; nothing is inferred and nothing is stopped.
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

/** The status work row Core reports for the stopping Run; it carries the failure only while stopping. */
const runRow = (failure?: unknown) => ({ kind: "run", id: "run-s", thread_id: "stopping", run_id: "run-s", state: "stopping", ...(failure === undefined ? {} : { stop_settlement_failure: failure }) });

async function open(failure?: unknown) {
  const f = await fixtureModel({ route: "conversation", threadId: "stopping", configure(db) {
    db.threads.stopping = summary("stopping", { state: "stopping", activity: "stopping" });
    db.details.stopping = { ...db.details.stopping!, run_id: "run-s" };
    db.work.stopping = [runRow(failure)];
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
  const f = await open();
  try {
    expect(line()).toBeNull();
    f.db.work.stopping = [runRow("storage")];
    await hint(f);
    expect(line()?.getAttribute("data-stop-settlement-failure")).toBe("storage");
    expect(line()?.getAttribute("data-stop-settlement-run")).toBe("run-s");
    expect(f.t.calls("run.stop")).toHaveLength(0);
    f.db.threads.stopping = summary("stopping", { state: "idle", activity: "stopped" });
    f.db.work.stopping = [];
    await hint(f);
    expect(line()).toBeNull();
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { f.model.dispose(); f.data.stop(); }
});

it("shows the invariant failure for the named Run as information only", async () => {
  const f = await open("invariant");
  try {
    expect(line()?.getAttribute("data-stop-settlement-failure")).toBe("invariant");
    expect(line()?.getAttribute("data-stop-settlement-run")).toBe("run-s");
    expect(line()?.querySelector("button")).toBeNull();
    expect(f.t.calls("run.stop")).toHaveLength(0);
  } finally { f.model.dispose(); f.data.stop(); }
});

it.each([
  ["a null failure", null],
  ["an unknown failure value", "disk"],
])("shows nothing for %s", async (_name, failure) => {
  const f = await open(failure);
  try {
    expect(line()).toBeNull();
  } finally { f.model.dispose(); f.data.stop(); }
});
