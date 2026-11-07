import { describe, expect, it } from "vitest";
import { MonitorSelection, type MonitorCriteria } from "../src/monitor-selection";
import { threadTree } from "../src/threads";
import { summary } from "../../data/test/harness";

const defaults = (): MonitorCriteria => ({ statuses: [], query: "", archive: "exclude", pinnedOnly: false, pins: [], refresh: 0 });
const rows = (activity = "running") => threadTree([
  summary("a", { title: "Alpha", activity }),
  summary("b", { title: "Beta", activity: "running" }),
  summary("c", { title: "Archived", activity: "completed", archived_at: "2026-01-01" }),
], new Map());
const ids = (s: ReturnType<MonitorSelection["select"]>) => s.rows.map((r) => r.summary.thread_id);
describe("monitor selection", () => {
  it("keeps status-changed rows at their stable position until refresh or filter change", () => {
    const s = new MonitorSelection(); const c = { ...defaults(), statuses: ["running"] as const };
    expect(ids(s.select(rows(), c))).toEqual(["a", "b"]);
    const changed = s.select(rows("completed"), c);
    expect(ids(changed)).toEqual(["a", "b"]); expect(changed.outOfFilter.has("a")).toBe(true);
    expect(ids(s.select(rows("completed"), { ...c, refresh: 1 }))).toEqual(["b"]);
    expect(ids(s.select(rows("completed"), { ...c, statuses: [] }))).toEqual(["a", "b"]);
  });
  it("keeps pinned threads despite state or archive filters and respects search", () => {
    const s = new MonitorSelection(); const c = { ...defaults(), statuses: ["running"] as const, pins: ["a", "c"], pinnedOnly: true };
    expect(ids(s.select(rows("completed"), c))).toEqual(["a", "c"]);
    expect(ids(s.select(rows("completed"), { ...c, query: "arch" }))).toEqual(["c"]);
    expect(c.pins).toEqual(["a", "c"]);
    expect(ids(s.select(rows(), { ...defaults(), pins: ["b"] }))).toEqual(["b", "a"]);
  });
  it("supports multiple statuses and archive scopes", () => {
    const s = new MonitorSelection();
    expect(ids(s.select(rows(), { ...defaults(), statuses: ["running", "completed"], archive: "include" }))).toEqual(["a", "b", "c"]);
    expect(ids(s.select(rows(), { ...defaults(), archive: "only" }))).toEqual(["c"]);
  });
});

import { connected, details, FakeTransport, flush } from "../../data/test/harness";
import { ShellboyData } from "../../data/src";
import { MissingPins } from "../src/monitor-selection";

describe("pins outside the loaded list", () => {
  it("bounds reads, uses owner facts, and only removes explicit not-found IDs", async () => {
    const t = new FakeTransport(); const data = new ShellboyData({ transport: t, newId: () => "test" });
    data.start(); t.open(); t.push({ t: "hello", bridge_version: "test", owner: connected }); await flush();
    const pins = new MissingPins(data.operations);
    pins.sync(["a", "b", "c", "d", "e"], [], true);
    expect(t.calls("thread.get")).toHaveLength(4);
    const first = t.calls("thread.get");
    t.ok(first[0]!.id, details("a", { title: "Pinned archive", archived_at: "2026-01-01", activity: "completed" }));
    t.ownerError(first[1]!.id, "not_found");
    t.ownerError(first[2]!.id, "busy");
    t.ok(first[3]!.id, details("d"));
    await flush(20);
    expect(pins.rows.value.find((r) => r.summary.thread_id === "a")?.summary.title).toBe("Pinned archive");
    expect(pins.deleted.value).toEqual(["b"]);
    expect(t.calls("thread.get")).toHaveLength(5);
    pins.close(); expect(t.cancels()).toContain(t.calls("thread.get")[4]!.id); data.stop();
  });
});
