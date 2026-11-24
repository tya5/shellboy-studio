// @vitest-environment happy-dom
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import type { LauncherState, WorkItem } from "../../../data/src/protocol";
import type { OwnerState } from "../../../data/src/protocol";

const connected = (instance_id: string): OwnerState => ({ state: "connected", info: { instance_id, protocol_version: 23, capabilities: [] } });
import { fixtureModel, settle } from "../../../ui-core/test/fixture";
import { CoreBanner, CoreSettings, CoreStatusLink } from "../screens/CoreSettings";

const launcher = (phase: LauncherState["phase"], extras: Partial<LauncherState> = {}): LauncherState => ({ phase, instance_id: null, ready_at_ms: null, automatic_restart_available: true, restarted_after: null, failure: null, ...extras });
const work: WorkItem[] = [{ kind: "run", id: "r", thread_id: "lead", thread_title: "Run Thread", state: "live" }, { kind: "shell", id: "s", thread_id: "lead", thread_title: "Shell Thread", state: "running" }];
const button = (host: ParentNode, title: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === title);

async function mount(test: (f: Awaited<ReturnType<typeof fixtureModel>>, host: HTMLElement, step: (change: () => void) => Promise<void>) => Promise<void>, items: WorkItem[] = []) {
  const f = await fixtureModel({ route: "settings", configure(db) {
    const answer = db.answer.bind(db);
    db.answer = call => call.command === "status" && (call.args as { limit?: number })?.limit === 200
      ? { ok: true, result: { instance_id: "i1", items } }
      : call.command === "config.set"
        ? { ok: true, result: { written: true, restart_required: true, changes: [{ field: "ui.language", restart_required: true }, { field: "ui.motion", restart_required: false }] } }
      : call.command === "owner.shutdown"
        ? { ok: false, code: "invalid_state", message: "shutdown is only available for serve owners" }
        : answer(call);
  } });
  const host = document.createElement("div");
  document.body.append(host);
  const step = async (change: () => void) => { await act(async () => { change(); await settle(f.t, f.db); }); };
  try {
    await step(() => {
      f.t.push({ t: "hello", bridge_version: "fixture", owner: connected("i1"), desktop: true, core_management: true, data_dir: "/fixture path" });
      render(<><CoreBanner model={f.model} /><CoreStatusLink model={f.model} /><CoreSettings model={f.model} /></>, host);
    });
    await step(() => {});
    await test(f, host, step);
  } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
}

it("shows the reported stage, then Start after Stop or a failed launch; no time or percentage", () => mount(async (f, host, step) => {
  await step(() => {
    f.t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } });
    f.t.push({ t: "launcher_state", state: launcher("starting") });
    f.t.push({ t: "startup_stage", stage: "database_migration" });
  });
  expect(host.textContent).toContain("Migrating the database (database_migration)");
  expect(host.textContent).not.toMatch(/%|remaining/i);
  expect(button(host, "Restart owner")).toBeUndefined();
  await step(() => button(host, "Stop Core")!.click());
  expect(f.t.sent).toContainEqual({ t: "launcher", action: "stop" });
  expect(host.querySelector("dialog")).toBeNull();
  await step(() => f.t.push({ t: "launcher_state", state: launcher("stopped") }));
  expect(host.textContent).toContain("Core stopped");
  expect(host.textContent).not.toContain("database_migration");
  await step(() => button(host, "Start Core")!.click());
  expect(f.t.sent).toContainEqual({ t: "launcher", action: "start" });
  await step(() => f.t.push({ t: "launcher_state", state: launcher("failed", { failure: "fixture failed", automatic_restart_available: false }) }));
  expect(host.textContent).toContain("fixture failed");
  expect(button(host, "Start Core")).toBeDefined();
}));

it.each(["Restart owner", "Stop Core"] as const)("confirms %s only while work is running", title => mount(async (f, host, step) => {
  await step(() => f.t.push({ t: "launcher_state", state: launcher("running", { instance_id: "i1", restarted_after: "fixture crash", automatic_restart_available: false }) }));
  expect(host.textContent).toContain("fixture crash");
  const shell = [...host.querySelectorAll("a")].find(a => a.textContent?.includes("Shell Thread"))!;
  expect(shell.hash).toBe("#/conversation/lead");
  await step(() => button(host, title)!.click());
  const dialog = host.querySelector("dialog[open]")!;
  expect(dialog.textContent).toContain("Run Thread");
  expect(dialog.textContent).toContain("Shell Thread");
  expect(document.activeElement).toBe(button(dialog, "Cancel"));
  expect(f.t.sent.some(frame => frame.t === "launcher")).toBe(false);
  await step(() => button(dialog, title)!.click());
  expect(f.t.sent).toContainEqual({ t: "launcher", action: title === "Stop Core" ? "stop" : "restart", instance_id: "i1" });
  await step(() => shell.click());
  expect(f.model.route.value).toEqual({ view: "conversation", threadId: "lead" });
  expect(f.model.coreActivityThread.value).toBe("lead");
}, work));

it("shows only Stop for an external owner, then hides it after the typed TUI refusal", () => mount(async (f, host, step) => {
  expect(host.textContent).toContain("Started outside Studio");
  expect(host.textContent).toContain("shellboy serve --data-dir '/fixture path'");
  expect(button(host, "Restart owner")).toBeUndefined();
  await step(() => button(host, "Stop Core")!.click());
  expect(host.querySelector("dialog")).toBeNull();
  expect(f.t.calls("owner.shutdown")[0]).toMatchObject({ args: { instance_id: "i1" }, operation_id: expect.any(String) });
  expect(host.textContent).toContain("invalid_state: shutdown is only available for serve owners");
  expect(button(host, "Stop Core")).toBeUndefined();
}));

it("does not prompt for a managed Restart with no live work and shows pending keys for this instance", () => mount(async (f, host, step) => {
  await step(() => {
    void f.model.ops.configSet("hash", [{ field: "ui.language", value: "ja" }, { field: "ui.motion", value: "off" }]);
    f.t.push({ t: "launcher_state", state: launcher("running", { instance_id: "i1" }) });
  });
  expect(host.textContent).toContain("Restart pending");
  expect(host.textContent).toContain("ui.language");
  expect(host.textContent).not.toContain("ui.motion");
  await step(() => button(host, "Restart owner")!.click());
  expect(host.querySelector("dialog")).toBeNull();
  expect(f.t.sent).toContainEqual({ t: "launcher", action: "restart", instance_id: "i1" });
  await step(() => f.t.push({ t: "owner", event: "restarted", owner: connected("i2") }));
  expect(host.textContent).not.toContain("ui.language");
}));
