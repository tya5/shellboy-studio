import { describe, expect, it } from "vitest";
import {
  activityLabel, byUrgency, composerAction, contextFacts, countByStatus, folderName, formatAge, plainExcerpt, formatDuration, formatRoute, formatTokens,
  LANGS, loadPrefs, MESSAGES, noPending, parseRoute, projectConversation, recoveryFacts, savePrefs, statusOfActivity, statusOfShell, threadTree,
  translator, usageFacts, viewShortcut, navShortcut,
} from "../src";
import { details, summary } from "../../data/test/harness";
import type { ThreadSummary, ThreadDetails } from "../../data/src";

const s = (id: string, extra: Record<string, unknown> = {}) => summary(id, extra) as unknown as ThreadSummary;
const d = (extra: Record<string, unknown>) => details("a", extra) as unknown as ThreadDetails;

describe("status", () => {
  it("maps every owner activity word to one state, and unknown words to none", () => {
    for (const word of ["sending", "reflecting", "preparing", "awaiting_model", "retrying", "receiving", "tools", "running", "background", "continuing", "stopping"])
      expect(statusOfActivity(word)).toBe("running");
    expect(statusOfActivity("recovery")).toBe("recovery");
    expect(statusOfActivity("waiting")).toBe("waiting");
    expect(statusOfActivity("completed")).toBe("completed");
    expect(statusOfActivity("new_word")).toBeUndefined();
  });
  it("activity never means a person is awaited; only the adapter does", () => {
    for (const word of Object.keys({ waiting: 1, awaiting_model: 1 })) expect(statusOfActivity(word)).not.toBe("awaiting");
  });
  it("shell states need an exit code of 0 to count as completed", () => {
    expect(statusOfShell("exited", 0)).toBe("completed");
    expect(statusOfShell("exited", 1)).toBe("failed");
    expect(statusOfShell("exited", undefined)).toBe("failed");
    expect(statusOfShell("running", null)).toBe("running");
    expect(statusOfShell("mystery", null)).toBeUndefined();
  });
});

describe("format", () => {
  it("tokens", () => {
    expect(formatTokens(812)).toBe("812");
    expect(formatTokens(1280)).toBe("1.3k");
    expect(formatTokens(412000)).toBe("412k");
    expect(formatTokens(1200000)).toBe("1.2M");
  });
  it("durations", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(2400)).toBe("2.4s");
    expect(formatDuration(134000)).toBe("2m 14s");
    expect(formatDuration(3780000)).toBe("1h 3m");
  });
  it("ages and folder names; absent stays absent", () => {
    const now = Date.parse("2026-01-01T01:00:00Z");
    expect(formatAge("2026-01-01T00:48:00Z", now)).toBe("12m");
    expect(formatAge(undefined, now)).toBeUndefined();
    expect(formatAge("not a time", now)).toBeUndefined();
    expect(folderName("/home/me/dev/shellboy")).toBe("shellboy");
    expect(folderName(undefined)).toBeUndefined();
  });
});

describe("previews", () => {
  it("removes Markdown marks and keeps the words", () => {
    expect(plainExcerpt("Here is **the result** with `code`.\n\n- first\n- second\n\n```sh\ncargo test\n```\n\nSee [the docs](https://x.example) now."))
      .toBe("Here is the result with code. first second cargo test See the docs now.");
    expect(plainExcerpt(undefined)).toBeUndefined();
  });
});

describe("threads", () => {
  it("nests children under their parent, keeps the owner's order, keeps orphans", () => {
    const rows = threadTree([s("c", { parent_id: "p" }), s("p"), s("o", { parent_id: "gone" })]);
    expect(rows.map((r) => [r.summary.thread_id, r.depth])).toEqual([["p", 0], ["c", 1], ["o", 0]]);
    expect(rows[0]!.childCount).toBe(1);
    expect(rows[1]!.parentTitle).toBe("t-p");
  });
  it("a parent cycle can't hide a Thread", () => {
    expect(threadTree([s("a", { parent_id: "b" }), s("b", { parent_id: "a" })])).toHaveLength(2);
  });
  it("urgency puts what needs a person first and counts by state", () => {
    const rows = threadTree([s("x", { activity: "completed" }), s("y", { activity: "recovery" }), s("z", { activity: "tools" }), s("q", { activity: "idle" })], new Map([["q", 1]]));
    expect(byUrgency(rows).map((r) => r.summary.thread_id)).toEqual(["q", "y", "z", "x"]);
    expect(countByStatus(rows)).toEqual({ completed: 1, recovery: 1, running: 1, awaiting: 1 });
  });
});

describe("conversation projection", () => {
  it("hides bookkeeping, keeps messages, merges an execution's two nodes into one step", () => {
    const exec = { execution_id: "e", command_excerpt: "ls", state: "exited", cwd: "/w" };
    const rows = projectConversation(
      [
        { node_id: "1", kind: "user", excerpt: "hi", provenance: { sender: { kind: "human" } } },
        { node_id: "2", kind: "event", excerpt: "Shellboy event v1" },
        { node_id: "3", kind: "context", excerpt: "Shellboy context v1" },
        { node_id: "4", kind: "assistant_response", excerpt: '{"command":"ls"}', executions: [exec] },
        { node_id: "5", kind: "tool_result", excerpt: "{}", executions: [exec] },
        { node_id: "6", kind: "assistant_response", excerpt: "done" },
      ],
      new Map([["e", { execution_id: "e", state: "exited", exit_code: 0, started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:00:02.400Z" }]]),
    );
    expect(rows.map((r) => r.type)).toEqual(["message", "steps", "message"]);
    const step = rows[1]!.type === "steps" ? rows[1]!.steps[0]! : undefined;
    expect(step).toMatchObject({ command: "ls", status: "completed", exitCode: 0, durationMs: 2400, cwd: "/w" });
  });
  it("without shell facts a step shows no exit or duration rather than a guess", () => {
    const rows = projectConversation([{ node_id: "4", executions: [{ execution_id: "e", state: "running", command_excerpt: "x" }] }]);
    expect(rows[0]!.type === "steps" && rows[0]!.steps[0]).toMatchObject({ status: "running", exitCode: undefined, durationMs: undefined });
  });
  it("names the sender from the owner's record", () => {
    const one = (sender: Record<string, unknown>) => projectConversation([{ node_id: "1", kind: "user", excerpt: "x", provenance: { sender: sender as { kind: string } } }])[0]!;
    expect(one({ kind: "human" })).toMatchObject({ speaker: { kind: "you" } });
    expect(one({ kind: "external_cli" })).toMatchObject({ speaker: { kind: "cli" } });
    expect(one({ kind: "thread", label: "worker" })).toMatchObject({ speaker: { kind: "other", label: "worker" } });
  });
  it("flags a message cut at the excerpt limit, counted in characters", () => {
    const rows = projectConversation([{ node_id: "1", kind: "assistant_response", excerpt: "x".repeat(4096) }, { node_id: "2", kind: "assistant_response", excerpt: "short" }]);
    expect(rows[0]).toMatchObject({ truncated: true });
    expect(rows[1]).toMatchObject({ truncated: false });
  });
  it("an unknown kind is shown as a note, not dropped", () => {
    expect(projectConversation([{ node_id: "1", kind: "summary", excerpt: "the summary" }])[0]).toMatchObject({ type: "note", kind: "summary" });
  });
});

describe("usage facts", () => {
  it("shows measured values only", () => {
    expect(contextFacts(d({}))).toBeUndefined();
    expect(contextFacts(d({ context_usage: { last_successful_attempt: null } }))).toBeUndefined();
    expect(contextFacts(d({ context_usage: { last_successful_attempt: { input_tokens: 1200 } }, effective_auto_compact_at: 200000 }))).toEqual({ inputTokens: 1200, autoSummaryAt: 200000 });
    expect(usageFacts(d({}))).toBeUndefined();
  });
  it("a sum with unknown records is marked partial and gives no percentage", () => {
    const make = (unknown: number) =>
      usageFacts(d({ usage_totals: { model_attempts: { completed: { count: 2, input_tokens: { known_sum: 2400, unknown_count: 0 }, cached_tokens: { known_sum: 1600, unknown_count: unknown }, output_tokens: { known_sum: null, unknown_count: 2 } } } } }));
    expect(make(0)).toMatchObject({ cachedPercent: 67, output: undefined, partial: false, attempts: 2 });
    expect(make(1)).toMatchObject({ cachedPercent: undefined, partial: true });
  });
  it("recovery reason: JSON gives the message, plain text stays as it is", () => {
    expect(recoveryFacts(d({ recovery_reason: JSON.stringify({ message: "m", hint: "h" }) }))).toEqual({ message: "m", hint: "h" });
    expect(recoveryFacts(d({ recovery_reason: "plain" }))).toEqual({ message: "plain", hint: undefined });
    expect(recoveryFacts(d({}))).toBeUndefined();
  });
});

describe("routes, prefs, commands, words", () => {
  it("routes round-trip; a token fragment is not a route", () => {
    for (const r of [{ view: "monitor" }, { view: "inbox" }, { view: "conversation", threadId: "a/b" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(parseRoute("#token=abc")).toEqual({ view: "conversation" });
    expect(parseRoute("")).toEqual({ view: "conversation" });
  });
  it("prefs default to the first design, English; damaged or removed values fall back", () => {
    const designs = [{ name: "console", themes: [{ name: "console" }, { name: "light" }] }];
    const store = (v: string | null) => ({ read: () => v, write() {} });
    expect(loadPrefs(store(null), designs)).toEqual({ design: "console", theme: "console", lang: "en", navCollapsed: false, monitorPins: [], monitorView: "cards", monitorSort: "stable", weights: { cached: 0.1, output: 5 } });
    expect(loadPrefs(store("{oops"), designs)).toEqual({ design: "console", theme: "console", lang: "en", navCollapsed: false, monitorPins: [], monitorView: "cards", monitorSort: "stable", weights: { cached: 0.1, output: 5 } });
    expect(loadPrefs(store('{"design":"gone","theme":"light","lang":"ja"}'), designs)).toEqual({ design: "console", theme: "light", lang: "ja", navCollapsed: false, monitorPins: [], monitorView: "cards", monitorSort: "stable", weights: { cached: 0.1, output: 5 } });
    expect(loadPrefs(store('{"theme":"gone"}'), designs).theme).toBe("console");
    expect(loadPrefs(store('{"navCollapsed":true}'), designs).navCollapsed).toBe(true);
    expect(loadPrefs(store('{"navCollapsed":"true"}'), designs).navCollapsed).toBe(false);
    expect(loadPrefs(store('{"monitorSort":"recent"}'), designs).monitorSort).toBe("recent");
    expect(loadPrefs(store('{"monitorSort":"invalid"}'), designs).monitorSort).toBe("stable");
  });
  it("a blocked store doesn't throw", () => {
    expect(() => savePrefs({ read: () => null, write: () => { throw new Error("blocked"); } }, { design: "x", theme: "y", lang: "en", weights: { cached: 0, output: 1 } })).not.toThrow();
  });
  it("Enter sends unless an IME is composing or Shift is held", () => {
    expect(composerAction({ key: "Enter" })).toBe("send");
    expect(composerAction({ key: "Enter", isComposing: true })).toBe("none");
    expect(composerAction({ key: "Enter", shiftKey: true })).toBe("none");
    expect(composerAction({ key: "a" })).toBe("none");
    expect(navShortcut({ key: "0", altKey: true })).toBe(true);
    expect(navShortcut({ key: "0", altKey: true, shiftKey: true })).toBe(false);
    expect(navShortcut({ key: "0", altKey: true, isComposing: true })).toBe(false);
    expect(viewShortcut({ key: "2", altKey: true })).toBe("monitor");
    expect(viewShortcut({ key: "2" })).toBeUndefined();
  });
  it("every language has every word, with the same placeholders", () => {
    const names = (x: string) => (x.match(/\{\w+\}/g) ?? []).sort().join();
    for (const lang of LANGS)
      for (const [key, text] of Object.entries(MESSAGES.en)) {
        const other = MESSAGES[lang][key as keyof typeof MESSAGES.en];
        expect(other, `${lang} ${key}`).toBeTruthy();
        expect(names(other), `${lang} ${key}`).toBe(names(text));
      }
    expect(translator("en")("monitor.children", { n: 3 })).toBe("3 child threads");
    expect(activityLabel("ja", "recovery")).toBe("復旧待ち");
    expect(activityLabel("en", "new_word")).toBe("new_word");
  });
  it("no text glyph marks in the wording", () => {
    for (const lang of LANGS) for (const text of Object.values(MESSAGES[lang])) expect(text).not.toMatch(/[◉⁂↳⋯├└✓✔✗●○■□▶▷]/u);
  });
  it("the production pending adapter is empty and reports it can't answer", async () => {
    expect(noPending.items.value).toEqual([]);
    expect(await noPending.answer("x", "y")).toMatchObject({ ok: false, error: { code: "not_available" } });
  });
});

describe("tool rows", () => {
  it("carries the call's description when the owner reports one, and the command either way", () => {
    const rows = projectConversation([
      { node_id: "n", kind: "assistant_response", executions: [{ execution_id: "e", command_excerpt: "cargo test", description: "Run the tests" }] },
      { node_id: "m", kind: "assistant_response", executions: [{ execution_id: "f", command_excerpt: "ls" }] },
    ] as never);
    const steps = rows.flatMap((r) => (r.type === "steps" ? r.steps : []));
    expect(steps.map((s) => [s.description, s.command])).toEqual([["Run the tests", "cargo test"], [undefined, "ls"]]);
  });
});
