import { describe, expect, it } from "vitest";
import { flush, settle } from "../../data/test/harness";
import {
  addSum, ANALYTICS_SECTIONS, analyticsSection, cacheRate, dayFacts, effectiveTokens, formatBytes, formatRoute, loadPrefs, savePrefs, usageChange, MAX_GROUPS, MAX_WINDOWS, meanInput, mergeGroups, niceMax, parseRoute, periodOf, periodTotals,
  hourlyTotals, rollingPeriod, readCompactionEvent, readGroup, readIndex, readStorage, readSum, readThreadSettings, settingsSection, SETTINGS_SECTIONS, splitParts, totalGroups, zoneOf, type Prefs,
} from "../src";
import { fixtureCompaction, fixtureIndex, fixtureModel, fixtureStorage, NOW, usageItem, usagePage } from "./fixture";

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
    expect(cacheRate(parts(100, 150, 10))).toBeUndefined();
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
    for (const r of [{ view: "analytics" }, { view: "analytics", section: "memory" }, { view: "settings" }, { view: "settings", section: "general" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(parseRoute("#/settings/nope")).toEqual({ view: "settings" });
    expect(parseRoute("#/analytics/nope")).toEqual({ view: "analytics" });
    // A section name of the other view isn't valid here.
    expect(parseRoute("#/analytics/shell")).toEqual({ view: "analytics" });
    expect(analyticsSection({ view: "analytics" })).toBe("overview");
    expect(settingsSection({ view: "settings", section: "memory" })).toBe("general");
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
  it("memory leaves out unsupported platform metrics and keeps the cache reason", async () => {
    const f = await fixtureModel();
    f.model.insights.refreshRead("memory"); await settle(f.t, f.db);
    const m = f.model.insights.memory.peek().value!;
    f.model.dispose(); f.data.stop();
    expect(m.metrics.map((x) => x.name)).toEqual(["footprint", "rss"]);
    const body = m.caches.find((c) => c.name === "body")!;
    expect(body).toMatchObject({ retained: undefined, limit: 33554432, reason: "UI cache owner is not available" });
    expect(body.retained).toBeUndefined();
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
    const s = readThreadSettings({ connection: "c", model: "m", auto_compact_at: null, effective_auto_compact_at: 60000, max_tokens: null, effective_max_tokens: 64000 });
    expect(s).toMatchObject({ autoCompactAt: undefined, effectiveAutoCompactAt: 60000, maxTokens: undefined, effectiveMaxTokens: 64000 });
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
    model.applyRoute({ view: "inbox" });
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

  it("each section reads only what it shows, when it opens", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "memory" });
    await settle(t, db);
    const count = (c: string) => t.calls(c).filter((x) => c !== "status" || (x.args as { memory?: boolean }).memory).length;
    expect(count("status")).toBe(1);
    for (const c of ["usage.get", "compact.list", "storage.status", "index.status"]) expect(count(c), c).toBe(0);
    const open = async (section: "storage" | "index" | "overview" | "tokens" | "threads" | "compaction") => {
      model.applyRoute({ view: "analytics", section });
      await settle(t, db);
    };
    await open("storage");
    expect(count("storage.status")).toBe(1);
    expect(count("index.status")).toBe(0);
    await open("index");
    expect(count("index.status")).toBe(1);
    expect(count("usage.get")).toBe(0);
    await open("overview");
    expect(count("usage.get")).toBe(2);
    expect(t.calls("usage.get").every((c) => (c.args as { group_by: string }).group_by === "day")).toBe(true);
    expect(count("compact.list")).toBe(0);
    await open("tokens");
    expect(count("usage.get")).toBe(2);
    await open("compaction");
    expect(count("usage.get")).toBe(2);
    expect(count("compact.list")).toBe(1);
    expect(t.calls("compact.list")[0]!.args).toMatchObject({ thread_id: "lead", limit: 50 });
    await open("threads");
    expect(t.calls("usage.get").filter((c) => (c.args as { group_by: string }).group_by === "thread")).toHaveLength(1);
  });

  it("the bridge's memory reads only with the Memory section, again on Refresh, and says why when unknown", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "overview" });
    await settle(t, db);
    expect(t.calls("bridge.memory")).toHaveLength(0);
    model.applyRoute({ view: "analytics", section: "memory" });
    await settle(t, db);
    expect(t.calls("bridge.memory")).toHaveLength(1);
    expect(model.insights.bridge.value.value?.rssBytes).toBe(41943040);
    model.applyRoute({ view: "analytics", section: "overview" });
    model.applyRoute({ view: "analytics", section: "memory" });
    await settle(t, db);
    expect(t.calls("bridge.memory")).toHaveLength(1);
    const plain = db.answer;
    db.answer = (c) => (c.command === "bridge.memory" ? { ok: true, result: { rss_bytes: null, unavailable_reason: "Not read on this platform" } } : plain(c));
    model.insights.refreshRead("bridge");
    await settle(t, db);
    expect(model.insights.bridge.value.value).toEqual({ rssBytes: undefined, reason: "Not read on this platform" });
  });

  it("leaving what shows a walk cancels its call, keeps its data and carries on from the same window", async () => {
    const endless: Record<string, unknown> = { first: usagePage([usageItem("2026-11-07", { input: 10, cached: 5, output: 1 })], "w1"), w1: usagePage([usageItem("2026-11-07", { input: 10, cached: 5, output: 1 })], "w2"), w2: usagePage([usageItem("2026-11-06", { input: 1, cached: 0, output: 1 })]) };
    const { t, db, model } = await fixtureModel({ usage: endless });
    model.applyRoute({ view: "analytics", section: "tokens" });
    await flush();
    const answer = (id: number, result: unknown) => {
      db.answered.add(id);
      t.ok(id, result);
    };
    answer(t.calls("usage.get")[0]!.id, endless.first);
    await flush();
    const second = t.calls("usage.get")[1]!;
    expect((second.args as { cursor: string }).cursor).toBe("w1");
    model.applyRoute({ view: "analytics", section: "storage" });
    await flush();
    expect(t.cancels()).toContain(second.id);
    db.answered.add(second.id);
    expect(model.insights.daily.state.value.coverage.windows).toBe(1);
    await settle(t, db);
    expect(t.calls("usage.get")).toHaveLength(2);
    model.applyRoute({ view: "inbox" });
    model.applyRoute({ view: "analytics", section: "overview" });
    await settle(t, db);
    const cursors = t.calls("usage.get").map((c) => (c.args as { cursor?: string }).cursor);
    expect(cursors).toEqual([undefined, "w1", "w1", "w2"]);
    expect(model.insights.daily.state.value).toMatchObject({ status: "done" });
    expect(model.insights.daily.state.value.coverage.windows).toBe(3);
  });

  it("switching sections cancels a read for the one left, and reads it again on return", async () => {
    const { t, db, model } = await fixtureModel();
    model.applyRoute({ view: "analytics", section: "storage" });
    await flush();
    const first = t.calls("storage.status")[0]!;
    model.applyRoute({ view: "analytics", section: "memory" });
    await flush();
    expect(t.cancels()).toContain(first.id);
    db.answered.add(first.id);
    await settle(t, db);
    expect(model.insights.storage.value).toMatchObject({ loading: false, value: undefined, error: undefined });
    model.applyRoute({ view: "analytics", section: "storage" });
    await settle(t, db);
    expect(model.insights.storage.value.value).toBeDefined();
  });

  it("retries owner IPC loss on section reopen only for Memory", async () => {
    const { t, db, model, data } = await fixtureModel({ configure(db) {
      const answer = db.answer.bind(db);
      db.answer = call => ["usage.get", "compact.list", "storage.status", "index.status", "status", "bridge.memory"].includes(call.command)
        ? { ok: false, code: "app_not_running", message: "synthetic IPC loss" }
        : answer(call);
    } });
    try {
      const open = async (section: "tokens" | "compaction" | "storage" | "index" | "memory") => {
        model.insights.ensureAnalytics(section, "lead");
        await settle(t, db);
      };
      for (const section of ["tokens", "compaction", "storage", "index", "memory"] as const) await open(section);
      const count = () => ({
        tokens: t.calls("usage.get").length, compaction: t.calls("compact.list").length,
        storage: t.calls("storage.status").length, index: t.calls("index.status").length,
        receipts: t.calls("status").filter(call => (call.args as { limit?: number }).limit === 1).length,
        memory: t.calls("status").filter(call => (call.args as { memory?: boolean }).memory === true).length,
        bridge: t.calls("bridge.memory").length,
      });
      const before = count();
      expect(Object.values(before).every(n => n > 0)).toBe(true);
      for (const section of ["tokens", "compaction", "storage", "index", "memory"] as const) await open(section);
      expect(count()).toEqual({ ...before, memory: before.memory + 1 });
    } finally { model.dispose(); data.stop(); }
  });

  it("the same section re-running doesn't cancel its own reads", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "memory" });
    await settle(t, db);
    model.insights.refreshRead("memory");
    model.applyRoute({ view: "analytics", section: "memory" });
    await settle(t, db);
    expect(t.cancels()).toHaveLength(0);
  });

  it("walked data survives switching sections, also while a walk runs", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "overview" });
    await settle(t, db);
    const walked = model.insights.daily.state.value;
    expect(walked.status).toBe("done");
    model.applyRoute({ view: "analytics", section: "storage" });
    await settle(t, db);
    model.applyRoute({ view: "settings" });
    await settle(t, db);
    model.applyRoute({ view: "analytics", section: "tokens" });
    await settle(t, db);
    expect(model.insights.daily.state.value).toBe(walked);
    expect(t.calls("usage.get")).toHaveLength(2);
  });

  it("a period change drops the old period; only the open section reads the new one", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "threads" });
    await settle(t, db);
    const usage = (g: string) => t.calls("usage.get").filter((c) => (c.args as { group_by: string }).group_by === g).length;
    expect([usage("thread"), usage("day")]).toEqual([1, 0]);
    expect(model.insights.byThread.state.value.groups.get("lead")?.compactions).toBe(3);
    model.insights.setPeriod(31);
    await settle(t, db);
    expect([usage("thread"), usage("day")]).toEqual([2, 0]);
    expect(model.insights.period.value.dayKeys).toHaveLength(31);
    model.applyRoute({ view: "analytics", section: "tokens" });
    await settle(t, db);
    expect(usage("day")).toBe(2);
    const at = t.calls("usage.get").at(-1)!.args as { since: string };
    expect(at.since).toBe(model.insights.period.value.since);
  });

  it("compaction reads again for a new period and keeps the chosen Thread", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "compaction" });
    await settle(t, db);
    void model.insights.showCompaction("done");
    await settle(t, db);
    const before = t.calls("compact.list").length;
    model.insights.refreshUsage();
    await settle(t, db);
    expect(t.calls("compact.list").length).toBe(before + 1);
    expect(t.calls("compact.list").at(-1)!.args).toMatchObject({ thread_id: "done" });
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

  it("a by-Thread walk stops at its bound on groups and says so", async () => {
    const { t, db, model } = await fixtureModel({ route: "inbox" });
    const plain = db.answer;
    let n = 0;
    db.answer = (c) => {
      if (c.command !== "usage.get") return plain(c);
      const items = Array.from({ length: 168 }, () => usageItem(`thread-${n++}`, { input: 1, cached: 0, output: 1 }));
      return { ok: true, result: usagePage(items, "again") };
    };
    void model.insights.byThread.start();
    await settleLong(t, db);
    const s = model.insights.byThread.state.value;
    expect(s).toMatchObject({ status: "stopped", capped: true, canContinue: false });
    expect(s.groups.size).toBeGreaterThanOrEqual(MAX_GROUPS);
    expect(s.groups.size).toBeLessThan(MAX_GROUPS + 168);
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
    t.push({ t: "hello", bridge_version: "0.0.1", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: [] } } });
    await settle(t, db);
    // Nothing to redo: the values read are still the saved facts.
    expect(t.calls("usage.get").length).toBe(before);
  });

  it("compaction is one call per Thread, never one per Thread in the list", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics", section: "compaction" });
    await settle(t, db);
    expect(t.calls("compact.list")).toHaveLength(1);
    void model.insights.showCompaction("done");
    await settle(t, db);
    expect(t.calls("compact.list")).toHaveLength(2);
    expect(model.insights.compaction.value.events).toHaveLength(2);
  });

  it("Settings reads per section and opens no history; the catalog waits for a press", async () => {
    const { t, db, model } = await fixtureModel({ route: "settings" });
    await settle(t, db);
    expect(t.calls("history.list")).toHaveLength(0);
    expect(t.calls("thread.get")).toHaveLength(0);
    for (const c of ["storage.status", "index.status", "model.list"]) expect(t.calls(c), c).toHaveLength(0);
    model.applyRoute({ view: "settings", section: "general" });
    await settle(t, db);
    expect(t.calls("thread.get")).toHaveLength(0);
    model.applyRoute({ view: "settings", section: "index" });
    await settle(t, db);
    expect(t.calls("index.status")).toHaveLength(1);
    expect(t.calls("storage.status")).toHaveLength(0);
    model.applyRoute({ view: "settings", section: "storage" });
    await settle(t, db);
    expect(t.calls("storage.status")).toHaveLength(1);
    expect(t.calls("model.list")).toHaveLength(0);
    void model.insights.readCatalog();
    await settle(t, db);
    expect(model.insights.catalog.value.value?.models).toContain("mock-small");
  });

  it("a failed resource read keeps the last value and carries the error", async () => {
    const { t, db, model } = await fixtureModel({ route: "settings", section: "storage" });
    await settle(t, db);
    const plain = db.answer;
    db.answer = (c) => (c.command === "storage.status" ? { ok: false, code: "io_failed" } : plain(c));
    model.insights.refreshRead("storage");
    await settle(t, db);
    const s = model.insights.storage.value;
    expect(s.value?.dbBytes).toBe(fixtureStorage.db_bytes);
    expect(s.error).toMatchObject({ kind: "owner", code: "io_failed" });
  });

  it("never sends a mutation", async () => {
    const { t, db, model } = await fixtureModel({ route: "analytics" });
    await settle(t, db);
    for (const section of ANALYTICS_SECTIONS) {
      model.applyRoute({ view: "analytics", section });
      await settle(t, db);
    }
    for (const section of SETTINGS_SECTIONS) {
      model.applyRoute({ view: "settings", section });
      await settle(t, db);
    }
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
    for (const counter of [raw.compaction.input_tokens, raw.compaction.cached_tokens, raw.compaction.output_tokens]) {
      counter.known_sum = null;
      counter.unknown_count = 1;
    }
    const unknown = dayFacts(["d"], new Map([["d", readGroup(raw)!]]), WEIGHTS)[0]!;
    expect(unknown.summaryEffective).toBeUndefined();
    expect(unknown.incomplete).toBe(true);
    expect(unknown.effective).toBe(100);
    expect(unknown.effectiveLowerBound).toBe(true);
  });
  it("marks a day whose counters have unknowns or disagree", () => {
    expect(dayFacts(["d"], new Map([["d", group("d", { input: 100, cached: 50, output: 1, unknown: 2 })]]), WEIGHTS)[0]!.incomplete).toBe(true);
    const bad = dayFacts(["d"], new Map([["d", group("d", { input: 100, cached: 150, output: 1 })]]), WEIGHTS)[0]!;
    expect(bad).toMatchObject({ inconsistent: true, uncached: undefined, rate: undefined });
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




describe("rolling Overview", () => {
  it("generates the owner's fixed-offset hour keys and clips both ends", () => {
    const exact = rollingPeriod(Date.parse("2026-11-07T10:30:00Z"), 330);
    expect(exact.hours).toHaveLength(24);
    expect(exact.hours.every(h => !h.partial)).toBe(true);
    const partial = rollingPeriod(NOW, 330);
    expect(partial.hours).toHaveLength(25);
    expect(Date.parse(partial.until) - Date.parse(partial.since)).toBe(86_400_000);
    expect(partial.hours[0]).toMatchObject({key: "2026-11-06T15:00:00+05:30", since: "2026-11-06T15:50:00.000+05:30", partial: true});
    expect(partial.hours.at(-1)).toMatchObject({until: "2026-11-07T15:50:00.000+05:30", partial: true});
  });

  it("sums reported pairs, not ratios, and refuses missing or inconsistent input", () => {
    const g = (key: string, input: number | null, cached: number | null) => readGroup(usageItem(key, { input, cached, output: null }))!;
    expect(hourlyTotals([g("a", 100, 50), g("b", 900, 250)])).toEqual({ requests: 20, uncached: 700, share: 0.3 });
    expect(hourlyTotals([g("a", 5, 10), g("b", 900, 250)])).toEqual({ requests: 20, uncached: undefined, share: undefined });
    expect(hourlyTotals([g("a", 10, null)]).uncached).toBeUndefined();
    expect(hourlyTotals([]).requests).toBeUndefined();
  });

  it("admits no bucket read when the first Overview request is superseded before settling", async () => {
    let now = NOW;
    const { model, t, db } = await fixtureModel({ route: "analytics", section: "overview", nowMs: () => now });
    const { insights } = model;
    const usage = (group: string) => t.calls("usage.get").filter(c => (c.args as { group_by: string }).group_by === group);
    insights.rolling.enabled.value = true;
    await flush();
    const old = usage("hour")[0]!;
    const selected = insights.rolling.displayed.peek()!.interval.hours.at(-1)!;
    insights.selectBucketThreads(selected.key);
    expect(insights.rolling.admitted.peek()).toBeUndefined();
    expect(usage("thread")).toHaveLength(0);
    now += 60_000;
    t.push({ t: "resync" });
    db.answered.add(old.id);
    await flush();
    expect(t.cancels()).toContain(old.id);
    expect(usage("hour")).toHaveLength(2);
    expect(usage("thread")).toHaveLength(0);
    t.ok(old.id, usagePage([]));
    await flush();
    expect(insights.rolling.admitted.peek()).toBeUndefined();
    expect(usage("thread")).toHaveLength(0);
    await settle(t, db);
    const admitted = insights.rolling.admitted.peek()!;
    expect(Date.parse(admitted.interval.until)).toBe(now);
    expect(usage("thread")).toHaveLength(1);
    expect(usage("thread")[0]!.args).toMatchObject({ since: selected.since, until: admitted.interval.hours.at(-1)!.until });
    model.dispose();
  });

  it("cancels obsolete bucket reads, rekeys clipped bounds after a hint, and clears on owner switch", async () => {
    let now = NOW;
    const { model, t, db } = await fixtureModel({ route: "analytics", section: "overview", nowMs: () => now });
    const insights = model.insights;
    insights.rolling.enabled.value = true;
    await settle(t, db);
    const interval = insights.rolling.interval.peek()!;
    const rankCalls = () => t.calls("usage.get").filter(call => (call.args as { group_by?: string }).group_by === "thread");
    expect(rankCalls()).toHaveLength(0);
    insights.selectBucketThreads(interval.hours[0]!.key);
    const first = rankCalls().at(-1)!;
    const last = interval.hours.at(-1)!;
    insights.selectBucketThreads(last.key);
    const held = rankCalls().at(-1)!;
    const argsOf = (call: typeof held) => call.args as { since: string; until: string; timezone: string };
    expect(t.cancels()).toContain(first.id);
    expect(Date.parse(argsOf(held).until)).toBe(Date.parse(last.until));
    expect(argsOf(held).timezone).toBe("+09:00");
    expect(insights.bucketDrilldown.peek()).toMatchObject({ key: last.key, owner: "i1", hint: 0 });
    now += 60_000;
    t.push({ t: "resync" });
    expect(t.cancels()).toContain(held.id);
    expect(insights.bucketDrilldown.peek()).toMatchObject({ key: last.key, until: last.until, stale: true });
    db.answered.add(first.id);
    db.answered.add(held.id);
    await settle(t, db);
    const replacement = rankCalls().at(-1)!;
    expect(replacement.id).not.toBe(held.id);
    expect(argsOf(replacement).since).toBe(argsOf(held).since);
    expect(Date.parse(argsOf(replacement).until)).toBe(Date.parse(last.until) + 60_000);
    const fresh = insights.bucketDrilldown.peek();
    expect(fresh).toMatchObject({ key: last.key, owner: "i1" });
    t.ok(held.id, usagePage([usageItem("obsolete", { count: 500, input: null, cached: null, output: null })]));
    await flush();
    expect(insights.bucketDrilldown.peek()).toBe(fresh);
    expect(fresh?.walk.state.peek().groups.has("obsolete")).toBe(false);
    insights.observeRollingOwner("owner-b", 1, "owner-b");
    expect(insights.bucketDrilldown.peek()).toBeUndefined();
    expect(insights.rolling.displayed.peek()?.selection).toBeUndefined();
    model.dispose();
  });

  it("cancels a held cursor on resync and publishes the stopped replacement as partial", async () => {
    let now = NOW;
    const until = () => rollingPeriod(now, 540);
    const old = until();
    const firstHour = old.hours[0]!;
    const item = (key: string, count: number) => usageItem(key, { count, input: 100, cached: 50, output: 2 });
    const { model, t, db } = await fixtureModel({ route: "analytics", section: "overview", nowMs: () => now,
      usage: { first: usagePage([item(firstHour.key, 4)]) } });
    const hourCalls = () => t.calls("usage.get").filter(c => (c.args as { group_by?: string }).group_by === "hour");
    const rolling = model.insights.rolling;
    rolling.enabled.value = true;
    await settle(t, db);
    rolling.select(firstHour.key);
    expect(rolling.displayed.peek()?.selection?.key).toBe(firstHour.key);

    t.push({ t: "changed", thread_ids: ["lead"], config_changed: false, list: true });
    await flush();
    const first = hourCalls().at(-1)!;
    db.answered.add(first.id);
    t.ok(first.id, usagePage([item(firstHour.key, 20)], "held"));
    await flush();
    const held = hourCalls().at(-1)!;
    expect(held.args).toMatchObject({ cursor: "held", since: old.since, until: old.until, timezone: old.zone });

    now += 3_600_000;
    t.push({ t: "resync" });
    t.push({ t: "changed", thread_ids: ["other"], config_changed: false, list: true });
    expect(t.cancels()).toContain(held.id);
    db.answered.add(held.id);
    const onCall = t.onCall;
    t.onCall = call => {
      onCall?.(call);
      if (call.command === "usage.get" && (call.args as { group_by?: string }).group_by === "hour") db.answered.add(call.id);
    };
    // Let resync's other tracked reads release the shared RPC queue, but keep the replacement held.
    await settle(t, db);
    t.onCall = onCall;
    const replacement = hourCalls().at(-1)!;
    expect(replacement.args).toMatchObject({ since: until().since, until: until().until, timezone: old.zone });
    t.ok(held.id, usagePage([item(firstHour.key, 500)], "obsolete"));
    await flush();
    expect(hourCalls().map(c => (c.args as { cursor?: string }).cursor)).toEqual([undefined, undefined, "held", undefined]);
    expect(rolling.displayed.peek()).toMatchObject({ stale: true, interval: old, selection: firstHour });
    expect(rolling.displayed.peek()?.walk.groups.get(firstHour.key)?.requests).toBe(4);
    expect(rolling.walk.state.peek().groups.size).toBe(0);

    const newHour = until().hours[0]!;
    t.ok(replacement.id, usagePage([item(newHour.key, 7)], "replacement-next"));
    await flush();
    const next = hourCalls().at(-1)!;
    expect(next.args).toMatchObject({ cursor: "replacement-next", since: until().since, until: until().until });
    expect(rolling.displayed.peek()).toMatchObject({ stale: true, interval: old, selection: firstHour });
    rolling.stop();
    expect(t.cancels()).toContain(next.id);
    db.answered.add(next.id);
    expect(rolling.displayed.peek()).toMatchObject({ stale: false, interval: until(), selection: undefined, walk: { status: "stopped", canContinue: true } });
    expect(rolling.displayed.peek()?.partial).toBe(true);
    expect(rolling.displayed.peek()?.walk.groups.get(newHour.key)?.requests).toBe(7);
    expect(rolling.displayed.peek()?.walk.groups.has(firstHour.key)).toBe(false);
    rolling.step(1);
    expect(rolling.displayed.peek()?.selection?.key).toBe(newHour.key);
    model.insights.setPeriod(1);
    await settle(t, db);
    expect(t.calls("usage.get").at(-1)?.args).toMatchObject({ group_by: "day", since: periodOf(1, now, 540).since });
    expect(rolling.displayed.peek()).toBeUndefined();
    model.dispose();
  });

  it("keeps comparison opt-in across preference round trips and separates exact and relative change", () => {
    let saved: string | null = null;
    const store = { read: () => saved, write: (value: string) => { saved = value; } };
    const designs = [{ name: "console", themes: [{ name: "light" }] }];
    expect(loadPrefs(store, designs).analyticsCompare).toBe(false);
    savePrefs(store, { ...loadPrefs(store, designs), analyticsCompare: true });
    expect(loadPrefs(store, designs).analyticsCompare).toBe(true);
    savePrefs(store, { ...loadPrefs(store, designs), analyticsCompare: false });
    expect(loadPrefs(store, designs).analyticsCompare).toBe(false);
    expect(usageChange(7, 0)).toEqual({ difference: 7, ratio: undefined });
    expect(usageChange(7, 5)).toEqual({ difference: 2, ratio: 0.4 });
    expect(usageChange(0, 5)).toEqual({ difference: -5, ratio: -1 });
    expect(usageChange(7, undefined)).toBeUndefined();
    expect(usageChange(undefined, 0)).toBeUndefined();
  });

  it("pages both periods concurrently with independent cursors and fixed bounds", async () => {
    let now = NOW;
    const { model, t, db } = await fixtureModel({ route: "analytics", section: "overview", nowMs: () => now });
    const rolling = model.insights.rolling;
    const current = rollingPeriod(now, 540);
    const previous = rollingPeriod(Date.parse(current.since), 540);
    const hours = () => t.calls("usage.get").filter(c => (c.args as { group_by: string }).group_by === "hour");
    const periods = [
      { interval: current, cursor: "current-page", count: 7, walk: rolling.walk },
      { interval: previous, cursor: "previous-page", count: 3, walk: rolling.comparison.walk },
    ];
    const ownCalls = (until: string) => hours().filter(c => (c.args as { until: string }).until === until);
    rolling.setComparison(true);
    rolling.enabled.value = true;
    await flush();
    expect(hours()).toHaveLength(2);

    // Keep both walks in flight across the clock change and finish them out of order.
    now += 3_600_000;
    for (const { interval, cursor, count } of periods) {
      const [first] = ownCalls(interval.until);
      expect(first!.args).toMatchObject({ since: interval.since, until: interval.until, timezone: "+09:00" });
      expect(first!.args).not.toHaveProperty("cursor");
      db.answered.add(first!.id);
      t.ok(first!.id, usagePage([usageItem(interval.hours[0]!.key, { count, input: null, cached: null, output: null })], cursor));
    }
    await flush();
    expect(hours()).toHaveLength(4);
    for (const { interval, cursor, walk } of periods) {
      const [, next] = ownCalls(interval.until);
      expect(next!.args).toMatchObject({ cursor, since: interval.since, until: interval.until, timezone: "+09:00" });
      expect(walk.state.peek().status).toBe("loading");
    }
    for (const { interval, count, walk } of [...periods].reverse()) {
      const [, next] = ownCalls(interval.until);
      db.answered.add(next!.id);
      t.ok(next!.id, usagePage([usageItem(interval.hours[0]!.key, { count, input: null, cached: null, output: null })]));
      await flush();
      expect(walk.state.peek().status).toBe("done");
      expect(walk.state.peek().groups.get(interval.hours[0]!.key)?.requests).toBe(count * 2);
    }
    expect(hours()).toHaveLength(4);
    expect(rolling.displayed.peek()?.interval).toEqual(current);
    expect(rolling.comparison.interval.peek()).toEqual(previous);
    model.dispose();
  });

  it("reads the previous period only on opt-in and rejects its obsolete cursor reply after resync", async () => {
    let now = NOW;
    const current = () => rollingPeriod(now, 540);
    const previous = () => rollingPeriod(Date.parse(current().since), 540);
    const { model, t, db } = await fixtureModel({ route: "analytics", section: "overview", nowMs: () => now });
    const rolling = model.insights.rolling;
    const hours = () => t.calls("usage.get").filter(c => (c.args as { group_by: string }).group_by === "hour");
    const page = (period: ReturnType<typeof current>, count: number, cursor?: string) =>
      usagePage([usageItem(period.hours[0]!.key, { count, input: 10, cached: 4, output: 1 })], cursor);
    const answer = db.answer.bind(db);
    db.answer = call => {
      const args = call.args as { group_by?: string; until?: string };
      if (call.command !== "usage.get" || args.group_by !== "hour") return answer(call);
      return { ok: true, result: args.until === current().until ? page(current(), 8) : page(previous(), 3) };
    };
    rolling.enabled.value = true;
    await settle(t, db);
    expect(hours()).toHaveLength(1);
    expect(hours()[0]!.args).toMatchObject({ since: current().since, until: current().until, timezone: "+09:00" });
    expect(rolling.comparison.interval.peek()).toBeUndefined();
    const currentCut = rolling.walk.state.peek();
    rolling.setComparison(true);
    await flush();
    const first = hours().at(-1)!;
    const oldPrevious = previous();
    expect(first.args).toMatchObject({ since: oldPrevious.since, until: oldPrevious.until, timezone: "+09:00" });
    db.answered.add(first.id);
    t.ok(first.id, page(oldPrevious, 2, "prior-held"));
    await flush();
    const held = hours().at(-1)!;
    expect(held.args).toMatchObject({ cursor: "prior-held", since: oldPrevious.since, until: oldPrevious.until, timezone: "+09:00" });
    expect(rolling.walk.state.peek()).toBe(currentCut);
    now += 3_600_000;
    t.push({ t: "resync" });
    expect(t.cancels()).toContain(held.id);
    db.answered.add(held.id);
    await settle(t, db);
    expect(hours().slice(-2).map(c => (c.args as { cursor?: string }).cursor)).toEqual([undefined, undefined]);
    expect(hours().slice(-2).map(c => (c.args as { until?: string }).until).sort()).toEqual([previous().until, current().until]);
    t.ok(held.id, page(oldPrevious, 500, "obsolete"));
    await flush();
    expect(hours()).toHaveLength(5);
    expect(rolling.displayed.peek()?.interval).toEqual(current());
    expect(rolling.comparison.interval.peek()?.hours.map(h => h.label)).toEqual(current().hours.map(h => h.label));
    expect(rolling.comparison.walk.state.peek().groups.get(previous().hours[0]!.key)?.requests).toBe(3);
    expect(rolling.comparison.walk.state.peek().groups.has(oldPrevious.hours[0]!.key)).toBe(false);
    rolling.setComparison(false);
    expect(rolling.comparison.interval.peek()).toBeUndefined();
    expect(rolling.comparison.walk.state.peek().status).toBe("idle");
    model.dispose();
  });
});
