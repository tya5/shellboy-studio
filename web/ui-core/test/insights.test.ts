import { describe, expect, it } from "vitest";
import { settle } from "../../data/test/harness";
import {
  addSum, cacheRate, dayFacts, effectiveTokens, formatBytes, formatRoute, loadPrefs, MAX_WINDOWS, meanInput, mergeGroups, niceMax, parseRoute, periodOf, periodTotals,
  readCompactionEvent, readGroup, readIndex, readMemory, readStorage, readSum, readThreadSettings, splitParts, totalGroups, zoneOf, type Prefs,
} from "../src";
import { fixtureCompaction, fixtureIndex, fixtureMemory, fixtureModel, fixtureStorage, NOW, usageItem, usagePage } from "./fixture";

const WEIGHTS = { cached: 0.1, output: 5 };
const parts = (input: number | null, cached: number | null, output: number | null) => readGroup(usageItem("d", { input, cached, output }))!.conversation;

/** `settle` stops at 50 rounds; a walk to the bound needs more. */
async function settleLong(t: Parameters<typeof settle>[0], db: Parameters<typeof settle>[1]): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      await settle(t, db);
      return;
    } catch {
      // Keep answering.
    }
  }
  throw new Error("did not settle");
}

describe("usage sums", () => {
  it("keeps known, unknown and overflow apart", () => {
    expect(readSum({ known_sum: 5, unknown_count: 2, overflow: false })).toEqual({ known: 5, unknown: 2, overflow: false });
    expect(readSum({ known_sum: null, unknown_count: 1, overflow: false }).known).toBeUndefined();
    const add = addSum({ known: 5, unknown: 1, overflow: false }, { known: undefined, unknown: 3, overflow: false });
    expect(add).toEqual({ known: 5, unknown: 4, overflow: false });
    expect(addSum({ known: 5, unknown: 0, overflow: true }, { known: 1, unknown: 0, overflow: false }).known).toBeUndefined();
  });
  it("splits input into uncached and cached without repairing a provider's figures", () => {
    expect(splitParts(parts(100, 75, 10))).toEqual({ uncached: 25, cached: 75, output: 10, inconsistent: false });
    expect(splitParts(parts(100, 150, 10))).toMatchObject({ uncached: undefined, inconsistent: true });
    expect(splitParts(parts(100, null, 10))).toMatchObject({ uncached: undefined, inconsistent: false });
    expect(cacheRate(parts(100, 150, 10))).toBe(1.5);
    expect(cacheRate(parts(0, 0, 0))).toBeUndefined();
    expect(cacheRate(parts(null, 10, 0))).toBeUndefined();
  });
  it("effective tokens: uncached + cached x n + output x m, unknown stays unknown", () => {
    expect(effectiveTokens(parts(1000, 750, 20), WEIGHTS)).toBeCloseTo(250 + 75 + 100);
    expect(effectiveTokens(parts(1000, 750, 20), { cached: 0.5, output: 1 })).toBeCloseTo(250 + 375 + 20);
    expect(effectiveTokens(parts(1000, null, 20), WEIGHTS)).toBeUndefined();
    expect(effectiveTokens(parts(1000, 2000, 20), WEIGHTS)).toBeUndefined();
  });
  it("counts only terminal request states as usage", () => {
    const g = readGroup(usageItem("d", { input: 100, cached: 50, output: 5, state: "active" }))!;
    expect(g.requests).toBe(0);
    expect(g.conversation.input.known).toBeUndefined();
    expect(readGroup({ model_attempts: {} })).toBeUndefined();
  });
  it("merges counters of one group across windows; the mean is re-derived, percentiles are not", () => {
    const a = readGroup(usageItem("d", { input: 1000, cached: 500, output: 10, count: 10 }))!;
    const b = readGroup(usageItem("d", { input: 3000, cached: 1500, output: 30, count: 30, compactions: 2, summary: [50, 5, 7] }))!;
    const m = mergeGroups(a, b);
    expect(m.conversation.input.known).toBe(4000);
    expect(m.compactions).toBe(2);
    expect(m.summary.output.known).toBe(7);
    expect(meanInput(m)).toBeCloseTo(100);
    expect(m.inputMax).toBe(60000);
    expect(totalGroups([])).toBeUndefined();
  });
});

describe("period", () => {
  it("runs from the first calendar day to now, within the owner's 31 days", () => {
    const p = periodOf(31, NOW, 540);
    expect(p.dayKeys).toHaveLength(31);
    expect(p.dayKeys[30]).toBe("2026-11-07");
    expect(p.zone).toBe("+09:00");
    expect(Date.parse(p.until) - Date.parse(p.since)).toBeLessThanOrEqual(31 * 86_400_000);
    expect(new Date(Date.parse(p.since) + 540 * 60_000).toISOString().slice(11, 19)).toBe("00:00:00");
    expect(zoneOf(-330)).toBe("-05:30");
    expect(zoneOf(0)).toBe("+00:00");
  });
  it("a day after local midnight belongs to that local day", () => {
    const p = periodOf(1, Date.parse("2026-11-07T16:00:00Z"), 540);
    expect(p.dayKeys).toEqual(["2026-11-08"]);
  });
});

describe("chart scale and formats", () => {
  it("rounds up to 1, 2 or 5 x 10^k", () => {
    expect([1, 3, 7, 12, 2500, 0].map(niceMax)).toEqual([1, 5, 10, 20, 5000, 1]);
  });
  it("bytes reach GiB", () => {
    expect(formatBytes(4005957632)).toBe("3.7 GiB");
    expect(formatBytes(2048)).toBe("2 KiB");
  });
});

describe("routes", () => {
  it("round-trips the new views and rejects an unknown section", () => {
    for (const r of [{ view: "analytics" }, { view: "settings" }, { view: "settings", section: "shell" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(parseRoute("#/settings/nope")).toEqual({ view: "settings" });
  });
});

describe("weights are per browser", () => {
  const designs = [{ name: "console", themes: [{ name: "console" }] }];
  const store = (v: string) => ({ read: () => v, write: () => {} });
  it("keeps valid values and falls back field by field", () => {
    const load = (w: unknown): Prefs => loadPrefs(store(JSON.stringify({ weights: w })), designs);
    expect(load({ cached: 0.25, output: 3 }).weights).toEqual({ cached: 0.25, output: 3 });
    expect(load({ cached: -1, output: "x" }).weights).toEqual(WEIGHTS);
    expect(load({ cached: 0, output: 1 }).weights).toEqual({ cached: 0, output: 1 });
  });
});

describe("compaction events", () => {
  it("reads trigger and first request after, and keeps absence apart from null", () => {
    const [auto, manual] = fixtureCompaction.items.map(readCompactionEvent);
    expect(auto).toMatchObject({ kind: "automatic_reduction", reason: "proactive_threshold", triggerInput: 60000, autoAt: 60000, afterInput: 3300, afterApplies: true, summaryRequests: 1 });
    expect(auto!.summary?.input.known).toBe(3200);
    expect(manual).toMatchObject({ kind: "manual", afterApplies: true, afterInput: undefined, triggerInput: undefined });
    expect(readCompactionEvent({ event_id: "e", kind: "spill" })).toMatchObject({ afterApplies: false });
    expect(readCompactionEvent({})).toBeUndefined();
  });
});

describe("resource facts", () => {
  it("memory leaves out what the platform doesn't provide and keeps the owner's reason for a cache", () => {
    const m = readMemory(fixtureMemory);
    expect(m.metrics.map((x) => x.name)).toEqual(["footprint", "rss"]);
    const body = m.caches.find((c) => c.name === "body")!;
    expect(body).toMatchObject({ retained: undefined, limit: 33554432, reason: "UI cache owner is not available" });
    expect(m.caches.find((c) => c.name === "replay")).toMatchObject({ retained: 57373, entries: 1, unit: "thread" });
  });
  it("storage keeps flags, categories and an absent free size", () => {
    const s = readStorage(fixtureStorage);
    expect(s.categories.find((c) => c.name === "index")?.bytes).toBe(524288000);
    expect(s).toMatchObject({ warning: false, limitReached: false, reclaimableIsLowerBound: true, freeBytes: 103160946688 });
    expect(readStorage({ ...fixtureStorage, filesystem_free_bytes: undefined }).freeBytes).toBeUndefined();
  });
  it("index reports spaces and the owner's reason", () => {
    expect(readIndex(fixtureIndex).spaces[0]).toMatchObject({ model: "mock-embed", segments: 812, selected: true });
    expect(readIndex({ reason: "Embedding connection/model is not configured", spaces: [] }).reason).toContain("not configured");
  });
  it("thread settings separate the Thread's own value from the one in use", () => {
    const s = readThreadSettings({ connection: "c", model: "m", auto_compact_at: null, effective_auto_compact_at: 60000, segment_chars: null, effective_segment_chars: 64000, reduce_rounds: 2, effective_reduce_rounds: 2 });
    expect(s).toMatchObject({ autoCompactAt: undefined, effectiveAutoCompactAt: 60000, effectiveSegmentChars: 64000, reduceRounds: 2 });
    expect(s.effort).toBeUndefined();
  });
});

describe("Insights over the fake transport", () => {
  it("nothing is read until a view opens", async () => {
    const { t } = await fixtureModel();
    for (const c of ["usage.get", "compact.list", "storage.status", "index.status", "model.list"]) expect(t.calls(c), c).toHaveLength(0);
  });

  it("Analytics walks the windows once, in order, with the same filters, and merges a day across windows", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics" });
    await settle(t, db);
    const calls = t.calls("usage.get");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.args).toMatchObject({ group_by: "day", timezone: "+09:00", limit: 168 });
    expect(calls[0]!.args).not.toHaveProperty("cursor");
    const { cursor, ...rest } = calls[1]!.args as Record<string, unknown>;
    expect(cursor).toBe("second");
    const { ...first } = calls[0]!.args as Record<string, unknown>;
    expect(rest).toEqual(first);
    const s = model.insights.daily.state.value;
    expect(s.status).toBe("done");
    expect(s.coverage.windows).toBe(2);
    expect(s.groups.get("2026-11-06")?.conversation.input.known).toBe(3000000);
    expect(s.groups.get("2026-11-06")?.compactions).toBe(2);
    model.tick();
    model.applyRoute({ view: "monitor" });
    model.applyRoute({ view: "analytics" });
    await settle(t, db);
    expect(t.calls("usage.get")).toHaveLength(2);
  });

  it("one call at a time: the next window waits for the reply", async () => {
    const { t, model } = await fixtureModel();
    model.applyRoute({ view: "analytics" });
    await Promise.resolve();
    const usage = () => t.calls("usage.get");
    expect(usage()).toHaveLength(1);
    expect(model.insights.daily.state.value.status).toBe("loading");
  });

  it("a period change reads again; by-Thread is reset and read only on request", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics" });
    await settle(t, db);
    expect(t.calls("usage.get").every((c) => (c.args as { group_by: string }).group_by === "day")).toBe(true);
    void model.insights.byThread.start();
    await settle(t, db);
    expect(model.insights.byThread.state.value.groups.get("lead")?.compactions).toBe(3);
    const before = t.calls("usage.get").length;
    model.insights.setPeriod(31);
    expect(model.insights.byThread.state.value.status).toBe("idle");
    await settle(t, db);
    expect(t.calls("usage.get").length).toBe(before + 2);
    expect(model.insights.period.value.dayKeys).toHaveLength(31);
  });

  it("stops at the window bound and continues from the same cursor on request", async () => {
    const endless: Record<string, unknown> = { first: usagePage([], "w0") };
    for (let i = 0; i < 200; i++) endless[`w${i}`] = usagePage([usageItem("2026-11-07", { input: 10, cached: 5, output: 1 })], `w${i + 1}`);
    const { t, db, model } = await fixtureModel({ route: "analytics", usage: endless });
    await settleLong(t, db);
    const s = model.insights.daily.state.value;
    expect(s.status).toBe("stopped");
    expect(s.canContinue).toBe(true);
    expect(s.coverage.windows).toBe(MAX_WINDOWS);
    expect(t.calls("usage.get")).toHaveLength(MAX_WINDOWS);
    void model.insights.daily.continue();
    await settleLong(t, db);
    expect((t.calls("usage.get")[MAX_WINDOWS]!.args as { cursor: string }).cursor).toBe(`w${MAX_WINDOWS - 1}`);
    expect(model.insights.daily.state.value.coverage.windows).toBe(2 * MAX_WINDOWS);
  });

  it("Stop halts after the call on the wire and keeps what was read", async () => {
    const endless: Record<string, unknown> = { first: usagePage([usageItem("2026-11-07", { input: 10, cached: 5, output: 1 })], "w") , w: usagePage([], "w") };
    const { t, db, model } = await fixtureModel({ usage: endless });
    model.applyRoute({ view: "analytics" });
    await Promise.resolve();
    const walk = model.insights.daily;
    t.ok(t.calls("usage.get")[0]!.id, endless.first);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(walk.state.value.coverage.windows).toBe(1);
    walk.stop();
    expect(walk.state.value).toMatchObject({ status: "stopped", canContinue: true });
    expect(walk.state.value.groups.size).toBe(1);
    await settle(t, db);
    expect(walk.state.value.status).toBe("stopped");
  });

  it("Stop before the first reply can still continue, from the start", async () => {
    const { t, db, model } = await fixtureModel();
    model.applyRoute({ view: "analytics" });
    await Promise.resolve();
    const walk = model.insights.daily;
    walk.stop();
    expect(walk.state.value).toMatchObject({ status: "stopped", canContinue: true });
    void walk.continue();
    await settle(t, db);
    expect(walk.state.value.status).toBe("done");
    expect(walk.state.value.coverage.windows).toBe(2);
  });

  it("an expired cursor keeps partial values, can't continue, and asks for a new read", async () => {
    const { t, db, model } = await fixtureModel();
    const plain = db.answer;
    let n = 0;
    db.answer = (c) => (c.command === "usage.get" && n++ === 1 ? { ok: false, code: "cursor_expired" } : plain(c));
    model.applyRoute({ view: "analytics" });
    await settle(t, db);
    const s = model.insights.daily.state.value;
    expect(s).toMatchObject({ status: "failed", canContinue: false });
    expect(s.groups.size).toBeGreaterThan(0);
  });

  it("doesn't repeat a finished walk when the connection comes back", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics" });
    expect(model.insights.daily.state.value.status).toBe("done");
    t.drop();
    const before = t.calls("usage.get").length;
    t.open();
    t.push({ t: "hello", bridge_version: "0.0.1", owner: { state: "connected", info: { protocol_version: 2, instance_id: "i1", capabilities: [] } } });
    await settle(t, db);
    // Nothing to redo: the values read are still the saved facts.
    expect(t.calls("usage.get").length).toBe(before);
  });

  it("compaction is one call per Thread, never one per Thread in the list", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics" });
    await settle(t, db);
    expect(t.calls("compact.list")).toHaveLength(1);
    expect(t.calls("compact.list")[0]!.args).toMatchObject({ thread_id: "lead", limit: 50 });
    void model.insights.showCompaction("done");
    await settle(t, db);
    expect(t.calls("compact.list")).toHaveLength(2);
    expect(model.insights.compaction.value.events).toHaveLength(2);
  });

  it("Settings reads resources and one thread.get, and opens no history; the catalog waits for a press", async () => {
    const { t, db, model } = await fixtureModel({ route: "settings" });
    await settle(t, db);
    expect(t.calls("history.list")).toHaveLength(0);
    expect(t.calls("thread.get")).toHaveLength(1);
    expect(model.insights.thread.value.value?.connection).toBe("c");
    expect(t.calls("storage.status")).toHaveLength(1);
    expect(t.calls("model.list")).toHaveLength(0);
    void model.insights.readCatalog();
    await settle(t, db);
    expect(model.insights.catalog.value.value?.models).toContain("mock-small");
  });

  it("a failed resource read keeps the last value and carries the error", async () => {
    const { t, db, model } = await fixtureModel({ route: "settings" });
    await settle(t, db);
    const plain = db.answer;
    db.answer = (c) => (c.command === "storage.status" ? { ok: false, code: "io_failed" } : plain(c));
    model.insights.refreshResources();
    await settle(t, db);
    const s = model.insights.storage.value;
    expect(s.value?.dbBytes).toBe(fixtureStorage.db_bytes);
    expect(s.error).toMatchObject({ kind: "owner", code: "io_failed" });
  });

  it("never sends a mutation", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics" });
    await settle(t, db);
    model.applyRoute({ view: "settings" });
    await settle(t, db);
    expect(t.calls().filter((c) => c.operation_id !== undefined)).toHaveLength(0);
    for (const c of ["storage.collect", "thread.set", "thread.prune", "index.rebuild"]) expect(t.calls(c)).toHaveLength(0);
  });
});

describe("what the charts draw", () => {
  const group = (key: string, f: Parameters<typeof usageItem>[1]) => readGroup(usageItem(key, f))!;
  it("a day the owner didn't return is absent, not zero", () => {
    const days = dayFacts(["2026-11-05", "2026-11-06"], new Map([["2026-11-06", group("2026-11-06", { input: 1000, cached: 750, output: 20 })]]), WEIGHTS);
    expect(days[0]).toMatchObject({ recorded: false, uncached: undefined, effective: undefined, rate: undefined });
    expect(days[1]).toMatchObject({ recorded: true, uncached: 250, cached: 750, output: 20, rate: 0.75 });
    expect(days[1]!.effective).toBeCloseTo(425);
  });
  it("adds summary requests to effective tokens and keeps them readable apart", () => {
    const g = group("d", { input: 1000, cached: 500, output: 10, compactions: 1, summary: [100, 20, 5] });
    const [day] = dayFacts(["d"], new Map([["d", g]]), WEIGHTS);
    expect(day!.summaryEffective).toBeCloseTo(80 + 2 + 25);
    expect(day!.effective).toBeCloseTo(500 + 50 + 50 + 107);
    expect(day!.summaryUncached).toBe(80);
  });
  it("no summary request is nothing to sum; a request with no usage is unknown", () => {
    const none = dayFacts(["d"], new Map([["d", group("d", { input: 100, cached: 0, output: 0 })]]), WEIGHTS)[0]!;
    expect(none.summaryEffective).toBe(0);
    const raw = usageItem("d", { input: 100, cached: 0, output: 0, compactions: 1 });
    (raw.compaction as Record<string, unknown>).input_tokens = { known_sum: null, unknown_count: 1, overflow: false };
    const unknown = dayFacts(["d"], new Map([["d", readGroup(raw)!]]), WEIGHTS)[0]!;
    expect(unknown.summaryEffective).toBeUndefined();
    expect(unknown.incomplete).toBe(true);
    expect(unknown.effective).toBe(100);
  });
  it("marks a day whose counters have unknowns or disagree", () => {
    expect(dayFacts(["d"], new Map([["d", group("d", { input: 100, cached: 50, output: 1, unknown: 2 })]]), WEIGHTS)[0]!.incomplete).toBe(true);
    const bad = dayFacts(["d"], new Map([["d", group("d", { input: 100, cached: 150, output: 1 })]]), WEIGHTS)[0]!;
    expect(bad).toMatchObject({ inconsistent: true, uncached: undefined, rate: 1.5 });
  });
  it("the period's rate comes from summed counters, never from an average of daily ratios", () => {
    const groups = new Map([
      ["a", group("a", { input: 1000, cached: 1000, output: 0 })],
      ["b", group("b", { input: 9000, cached: 0, output: 0 })],
    ]);
    const t = periodTotals(groups, WEIGHTS);
    expect(t.rate).toBeCloseTo(0.1);
    expect(t.days).toBe(2);
    expect(periodTotals(new Map(), WEIGHTS)).toMatchObject({ effective: undefined, days: 0 });
  });
});
