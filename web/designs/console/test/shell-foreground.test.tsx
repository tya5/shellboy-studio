// @vitest-environment happy-dom
// Studio #167 (Core #437): running shells in Activity say Foreground or Background from the typed
// `foreground` fact on shell.list only, and the foreground row shows its exact-execution Background action.
import "@preact/signals";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it } from "vitest";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { details, flush, settle } from "../../../data/test/harness";
import type { Lang } from "../../../ui-core/src/i18n";
import { Conversation } from "../screens/Conversation";

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

const started = "2026-11-07T10:20:00Z";
const work = (id: string) => ({ kind: "shell", id: `work-${id}`, thread_id: "lead", run_id: "run-1", execution_id: id, state: "running", turn_id: "turn-1", started_at: started });

async function open(lang: Lang = "en") {
  const f = await fixtureModel({ route: "conversation", threadId: "lead", capabilities: ["history.window"], lang, configure(db) {
    db.details.lead = details("lead", { run_id: "run-1", turn_id: "turn-1" });
    db.work.lead = [work("exec-fg"), work("exec-bg"), work("exec-unknown")];
    db.shells.lead = [
      { execution_id: "exec-fg", thread_id: "lead", run_id: "run-1", turn_id: "turn-1", state: "running", started_at: started, command_excerpt: "cargo build", foreground: true },
      { execution_id: "exec-bg", thread_id: "lead", run_id: "run-1", turn_id: "turn-1", state: "running", started_at: started, command_excerpt: "python -m http.server", foreground: false },
      { execution_id: "exec-unknown", thread_id: "lead", run_id: "run-1", turn_id: "turn-1", state: "running", started_at: started, command_excerpt: "sleep 30" },
    ];
  } });
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => { render(<Conversation model={f.model} />, host!); await settle(f.t, f.db); });
  return f;
}

/** The owner's saved fact moves the foreground shell to the background and sends its ordinary hint. */
async function confirmBackground(f: Awaited<ReturnType<typeof open>>) {
  f.db.shells.lead = f.db.shells.lead!.map(shell => shell.execution_id === "exec-fg" ? { ...shell, foreground: false } : shell);
  await act(async () => { f.t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false }); await settle(f.t, f.db); });
}

const row = (id: string) => host!.querySelector<HTMLElement>(`[data-panel-row-id="${id}"]`)!;
const mark = (id: string) => row(id).querySelector(".panel-list-main [data-status]")?.textContent ?? "";
const subtitle = (id: string) => row(id).querySelector(".panel-list-subtitle")?.textContent ?? "";
const visibleButtons = (id: string) => [...row(id).querySelectorAll<HTMLButtonElement>(":scope > button:not(.panel-list-main)")];
async function menuItems(id: string): Promise<string[]> {
  await act(async () => { row(id).querySelector<HTMLButtonElement>(".list-row-action button")!.click(); await flush(); });
  const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map(item => item.textContent?.trim() ?? "");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await flush(); });
  return items;
}

it("labels running shells from the typed foreground fact and puts Background on the foreground row", async () => {
  const f = await open();
  try {
    expect(mark("exec-fg")).toBe("Foreground");
    expect(mark("exec-bg")).toBe("Background");
    expect(row("exec-unknown").querySelector(".panel-list-main [data-status]")).toBeNull();
    // The placement is the row's status mark, not part of the elapsed-time subtitle.
    expect(subtitle("exec-fg")).not.toMatch(/Foreground|Background/);
    const fgButtons = visibleButtons("exec-fg");
    expect(fgButtons.map(button => button.textContent)).toEqual(["Move to background"]);
    expect(visibleButtons("exec-bg")).toEqual([]);
    expect(visibleButtons("exec-unknown")).toEqual([]);
    // The same action, not a second one: it leaves the foreground row's menu and stays in the others.
    expect(await menuItems("exec-fg")).not.toContain("Move to background");
    expect(await menuItems("exec-unknown")).toContain("Move to background");
    const before = f.t.calls("shell.background").length;
    await act(async () => { fgButtons[0]!.click(); await flush(8); await settle(f.t, f.db); });
    expect(f.t.calls("shell.background")).toHaveLength(before + 1);
    expect(f.t.calls("shell.background").at(-1)?.args).toEqual({ execution_id: "exec-fg" });
    // The owner confirms: the shell keeps running in the background, reported on its ordinary hint.
    const reads = { shell: f.t.calls("shell.list").length };
    fgButtons[0]!.focus();
    expect(document.activeElement).toBe(fgButtons[0]);
    await confirmBackground(f);
    expect(f.t.calls("shell.list").length).toBeGreaterThan(reads.shell);
    expect(mark("exec-fg")).toBe("Background");
    // The removed action held focus, so the row hands it to its own selection button.
    expect(document.activeElement).toBe(row("exec-fg").querySelector(".panel-list-main"));
    expect(visibleButtons("exec-fg")).toEqual([]);
    expect(await menuItems("exec-fg")).toContain("Move to background");
  } finally { f.model.dispose(); f.data.stop(); }
});

it("leaves focus alone when the person had already left the row", async () => {
  const f = await open();
  try {
    const button = visibleButtons("exec-fg")[0]!;
    button.focus();
    const elsewhere = row("exec-bg").querySelector<HTMLButtonElement>(".panel-list-main")!;
    elsewhere.focus();
    await confirmBackground(f);
    expect(visibleButtons("exec-fg")).toEqual([]);
    expect(document.activeElement).toBe(elsewhere);
  } finally { f.model.dispose(); f.data.stop(); }
});

it("uses the Japanese words 前面 and 裏", async () => {
  const f = await open("ja");
  try {
    expect(mark("exec-fg")).toBe("前面");
    expect(mark("exec-bg")).toBe("裏");
  } finally { f.model.dispose(); f.data.stop(); }
});
