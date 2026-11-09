import { effect } from "@preact/signals-core";
import { describe, expect, it } from "vitest";
import { BranchCompare, anchorCandidate, compareInteger, recordedCounter } from "../src/branch-compare";
import { readFamily } from "../src/branches";
import type { Operations } from "../../data/src";

const family = () => readFamily([{ thread_id: "a", root_thread_id: "a", items: [
  { thread_id: "a", branch_kind: "unknown", tip: { node_id: "a-tip" } },
  { thread_id: "b", parent_thread_id: "a", branch_kind: "fork", divergence: { node_id: "anchor", ordinal: 2 }, tip: { node_id: "b-tip" } },
  { thread_id: "c", parent_thread_id: "a", branch_kind: "rewind", divergence: { node_id: "other", ordinal: 9 } },
] }]);
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const counter = (known: unknown = 2) => ({ known_sum: known, unknown_count: 0, overflow: false });
const attempts = () => Object.fromEntries(["completed", "failed", "incomplete"].map(state => [state, Object.fromEntries(["input_tokens", "cached_tokens", "output_tokens"].map(key => [key, counter()]))]));
function fixture() {
  const calls: { kind: string; args: any; cancel: any }[] = [];
  let handler: ((kind: string, args: any) => Promise<any> | any) | undefined;
  const normal = (kind: string, args: any): any => {
    if (kind === "historyGet") return { ok: true, value: { node_id: args.node_id, kind: "user", text: "body", next_cursor: "body-next" } };
    if (kind === "usageGet") return { ok: true, value: { items: [{ key: args.thread_id, model_attempts: attempts() }], requested_period: { since: "2026-11-09T00:00:00Z", until: args.until }, scope_complete: true, excluded_time_count: 0, unknown_time_compaction_records: 0, malformed_compaction_records: 0, coverage: { summary: "recorded_first_request_at" } } };
    const start = args.ordinal ?? (args.thread_id === "a" ? 2 : 7);
    const length = args.node_id ? 1 : 50;
    return { ok: true, value: { thread_id: args.thread_id, revision: args.thread_id, total: 1000, items: Array.from({ length }, (_, n) => ({ node_id: n === 0 ? args.node_id ?? args.expect_node_id : `${args.thread_id}-${start + n}`, selection: { ordinal: start + n }, kind: "user", excerpt: "saved" })) } };
  };
  const ops = Object.fromEntries(["historyWindow", "historyGet", "usageGet"].map(kind => [kind, async (args: any, options: any) => {
    calls.push({ kind, args, cancel: options.cancel }); return handler ? handler(kind, args) : normal(kind, args);
  }])) as unknown as Operations;
  const c = new BranchCompare(ops, () => Date.parse("2026-11-09T12:00:00Z"));
  c.context("owner-a/branches/a", true); c.choose("a"); c.choose("b");
  return { c, calls, normal, handle: (fn: typeof handler) => { handler = fn; } };
}

describe("limited Branches compare contracts", () => {
  it("keeps recorded kind, never infers roots/legacy/future", () => {
    const f = family(); expect(f.items.map(i => i.branchKind)).toEqual(["unknown", "fork", "rewind"]);
    expect(readFamily([{ items: [{ thread_id: "x", branch_kind: "future" }] }]).items[0]!.branchKind).toBe("unknown");
  });
  it("only offers direct parent/child or same-parent same-anchor siblings", () => {
    const f = family(); const [a, b, c] = f.items;
    expect(anchorCandidate(a!, b!, f)).toBe("anchor"); expect(anchorCandidate(b!, a!, f)).toBe("anchor");
    expect(anchorCandidate(b!, c!, f)).toBeUndefined();
    expect(anchorCandidate(b!, { ...c!, divergence: b!.divergence }, f)).toBe("anchor");
    for (const flag of ["familyTruncated", "ancestorsTruncated", "rootParentUnavailable"]) expect(anchorCandidate(a!, b!, { ...f, [flag]: true })).toBeUndefined();
  });
  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity])("does not call unsafe/missing numeric metadata exact: %s", v => {
    expect(compareInteger(v)).toBe(false); expect(recordedCounter({ known_sum: v, unknown_count: 0, overflow: false }).exact).toBe(false);
  });
  it("distinguishes known zero, unknown field and owner overflow", () => {
    expect(recordedCounter(counter(0))).toMatchObject({ known: 0, exact: true });
    expect(recordedCounter({ ...counter(0), unknown_count: 1 }).exact).toBe(false);
    expect(recordedCounter({ ...counter(0), overflow: true }).exact).toBe(false);
  });
  it("verifies each local ordinal and revision independently with exactly four initial calls", async () => {
    const { c, calls } = fixture(); await c.refresh(family());
    expect(calls).toHaveLength(4); expect(calls.filter(x => x.args.ordinal !== undefined).map(x => x.args.ordinal)).toEqual([2, 7]);
    expect(c.state.value.sides.map(x => [x.ordinal, x.revision, x.pages.length])).toEqual([[2, "a", 1], [7, "b", 1]]);
    expect(calls.every(x => x.kind === "historyWindow")).toBe(true);
  });
  it("unsupported pairs do not probe APIs and selection never exceeds two", async () => {
    const { c, calls } = fixture(); c.choose("b"); c.choose("c"); c.choose("b");
    expect(c.state.value.selected).toEqual(["a", "c"]);
    const f = family(); f.items[1]!.divergence = undefined; f.items[2]!.divergence = undefined;
    await c.refresh(f); expect(calls).toHaveLength(0); expect(c.state.value.unavailable).toBe(true);
  });
  it("hints only mark stale, no reads or budget refill", async () => {
    const { c, calls } = fixture(); await c.refresh(family()); await c.usage(0); const before = calls.length;
    for (let n = 0; n < 100; n++) c.hint();
    expect(calls).toHaveLength(before); expect(c.state.value.stale).toBe(true); expect(c.state.value.sides[0]!.usageCalls).toBe(1);
  });
  it.each(["owner-b", "owner-a/route/new", ""])("cancels and discards delayed anchor success after context %s", async context => {
    const { c, calls, handle, normal } = fixture(); const release: (() => void)[] = [];
    handle((kind, args) => new Promise(resolve => release.push(() => resolve(normal(kind, args)))));
    const pending = c.refresh(family()); expect(calls).toHaveLength(2);
    c.context(context, context !== ""); for (const done of release) done(); await pending;
    expect(calls).toHaveLength(2); expect(c.state.value.sides).toEqual([]); expect(calls.every(x => x.cancel.cancelled)).toBe(true);
  });
  it("owner ABA and page change discard late errors without new requests", async () => {
    const { c, calls, handle } = fixture(); const release: (() => void)[] = [];
    handle(() => new Promise(resolve => release.push(() => resolve({ ok: false, error: { message: "late" } }))));
    const p = c.refresh(family()); c.context("B", true); c.context("owner-a/branches/a", true); c.pageChanged();
    release.forEach(f => f()); await p; expect(c.state.value.sides).toEqual([]); expect(calls).toHaveLength(2);
  });
  it("keeps two outstanding cancelled calls counted; reentry cannot refill or multiply RPCs", async () => {
    const { c, calls, handle, normal } = fixture(); const release: (() => void)[] = [];
    handle((kind, args) => new Promise(resolve => release.push(() => resolve(normal(kind, args)))));
    const p = c.refresh(family()); await c.refresh(family()); c.context("B", true); c.choose("a"); c.choose("b"); await c.refresh(family());
    expect(calls).toHaveLength(2); release.forEach(f => f()); await p;
    handle(undefined); await c.refresh(family()); expect(calls).toHaveLength(6);
  });
  it("holds a 4-page/50-row cache and requests one guarded page per explicit more", async () => {
    const { c, calls } = fixture(); await c.refresh(family()); for (let i = 0; i < 7; i++) await c.more(0);
    expect(c.state.value.sides[0]!.pages).toHaveLength(4); expect(c.state.value.sides[0]!.pages.every(p => p.length === 50)).toBe(true);
    expect(calls).toHaveLength(11); expect(calls.slice(4).every(x => x.args.after === 49 && x.args.expect_node_id)).toBe(true);
  });
  it("rejects changed revisions/unsafe ordinals and never copies left ordinal", async () => {
    const { c, calls, handle, normal } = fixture();
    handle((kind, args) => { const out = normal(kind, args); if (args.ordinal !== undefined) out.value.revision = "changed"; return out; });
    await c.refresh(family()); expect(c.state.value.sides.every(s => s.error === "pathChanged" && !s.pages.length)).toBe(true);
    expect(calls).toHaveLength(4);
  });
  it("uses same explicit until and only since_node/thread/UTC; no children or mutation calls", async () => {
    const { c, calls } = fixture(); await c.refresh(family()); await Promise.all([c.usage(0), c.usage(1)]);
    const usage = calls.filter(x => x.kind === "usageGet"); expect(usage).toHaveLength(2);
    expect(usage.map(x => x.args.thread_id)).toEqual(["a", "b"]); expect(usage[0]!.args.until).toBe(usage[1]!.args.until);
    for (const x of usage) { expect(x.args).toMatchObject({ since_node_id: "anchor", group_by: "thread", timezone: "UTC", limit: 168 }); expect(x.args.since).toBeUndefined(); expect(x.args.include_children).toBeUndefined(); }
    expect(c.state.value.sides[0]!.usage?.input).toMatchObject({ known: 6, exact: true });
  });
  it("owner 31-day refusal is unavailable, never clips/falls back", async () => {
    const { c, calls, handle, normal } = fixture(); await c.refresh(family());
    handle((kind, args) => kind === "usageGet" ? { ok: false, error: { code: "invalid_argument", message: "31 days" } } : normal(kind, args));
    await c.usage(0); await c.usage(0); expect(calls.filter(x => x.kind === "usageGet")).toHaveLength(1);
    expect(c.state.value.sides[0]).toMatchObject({ error: "usageUnavailable", usageCalls: 1 });
  });
  it("empty pages with cursor continue only explicitly and consume at most four responses", async () => {
    const { c, calls, handle, normal } = fixture(); await c.refresh(family()); let n = 0;
    handle((kind, args) => kind === "usageGet" ? { ok: true, value: { ...normal(kind, args).value, items: [], next_cursor: `c${++n}`, more: true, scan_truncated: true } } : normal(kind, args));
    for (let i = 0; i < 10; i++) await c.usage(0);
    expect(calls.filter(x => x.kind === "usageGet")).toHaveLength(4); expect(c.state.value.sides[0]!.usage).toMatchObject({ partial: true, responses: 4 });
  });
  it("duplicate cursor is not added twice and unsafe usage stays unknown", async () => {
    const { c, calls, handle, normal } = fixture(); await c.refresh(family());
    handle((kind, args) => { const out = normal(kind, args); if (kind === "usageGet") { out.value.items[0].model_attempts.completed.input_tokens = counter(Number.MAX_SAFE_INTEGER + 1); out.value.next_cursor = "same"; } return out; });
    await c.usage(0); await c.usage(0); await c.usage(0);
    expect(calls.filter(x => x.kind === "usageGet")).toHaveLength(2); expect(c.state.value.sides[0]!.usage?.input.exact).toBe(false);
  });
  it("shared aggregate limiter covers body/usage/history and rejects repeated in-flight actions", async () => {
    const { c, calls, handle, normal } = fixture(); await c.refresh(family()); const release: (() => void)[] = [];
    handle((kind, args) => new Promise(resolve => release.push(() => resolve(normal(kind, args)))));
    const a = c.openBody(0, "anchor"), b = c.usage(1); await c.more(0); await c.usage(0); await c.more(1); await tick();
    expect(calls).toHaveLength(6); release.forEach(f => f()); await Promise.all([a, b]);
  });
  it("body is one node, two requests even on failure; validates node identity", async () => {
    const { c, calls, handle } = fixture(); await c.refresh(family());
    handle(() => ({ ok: false, error: { message: "unavailable" } }));
    await c.openBody(0, "anchor"); await c.openBody(1, "anchor"); await c.openBody(0, "anchor"); await c.openBody(0, "anchor");
    expect(calls.filter(x => x.kind === "historyGet")).toHaveLength(2); expect(c.body.value.unavailable).toBe(true);
  });
  it("late body and usage results after leave do not project or start work", async () => {
    const { c, calls, handle, normal } = fixture(); await c.refresh(family()); const release: (() => void)[] = [];
    handle((kind, args) => new Promise(resolve => release.push(() => resolve(normal(kind, args)))));
    const a = c.openBody(0, "anchor"), b = c.usage(1); c.leave(); release.forEach(f => f()); await Promise.all([a,b]);
    expect(c.body.value.text).toBe(""); expect(c.state.value.sides).toEqual([]); expect(calls).toHaveLength(6);
  });
  it("refuses malformed/over31day returned periods without inventing a shorter scope", async () => {
    const { c, calls, handle, normal } = fixture(); await c.refresh(family());
    handle((kind, args) => { const out = normal(kind, args); if (kind === "usageGet") out.value.requested_period.since = "2020-01-01T00:00:00Z"; return out; });
    await c.usage(0); expect(c.state.value.sides[0]!.usage).toBeUndefined(); expect(c.state.value.sides[0]!.error).toBe("usageUnavailable");
    expect(calls.filter(x => x.kind === "usageGet")).toHaveLength(1);
  });
  it("safe individually measured values with unsafe client sum become unknown", async () => {
    const { c, handle, normal } = fixture(); await c.refresh(family());
    handle((kind, args) => { const out = normal(kind, args); if (kind === "usageGet") for (const state of Object.values(out.value.items[0].model_attempts) as any[]) state.input_tokens = counter(Number.MAX_SAFE_INTEGER); return out; });
    await c.usage(0); expect(c.state.value.sides[0]!.usage!.input).toMatchObject({ overflow: true, exact: false }); expect(c.state.value.sides[0]!.usage!.input.known).toBeUndefined();
  });
  it("wrong-side anchor response and unsafe ordinal stop before excerpt RPC", async () => {
    const { c, calls, handle, normal } = fixture();
    handle((kind, args) => { const out = normal(kind, args); out.value.items[0].selection.ordinal = Number.MAX_SAFE_INTEGER + 1; return out; });
    await c.refresh(family()); expect(calls).toHaveLength(2); expect(c.state.value.sides.every(x => x.error === "anchorUnavailable")).toBe(true);
  });
  it("stale hints block further reads until explicit refresh", async () => {
    const { c, calls } = fixture(); await c.refresh(family()); c.hint(); await c.more(0); await c.usage(1); await c.openBody(0,"anchor"); expect(calls).toHaveLength(4);
    await c.refresh(family()); expect(calls).toHaveLength(8);
  });
  it("body UTF8 limit and wrong node ID are unavailable rather than text from another target", async () => {
    const { c, handle } = fixture(); await c.refresh(family());
    handle(() => ({ ok: true, value: { node_id: "other", text: "x" } })); await c.openBody(0,"anchor"); expect(c.body.value.unavailable).toBe(true); expect(c.body.value.text).toBe("");
  });

  it.each(["initial", "busy", "metadata"])("rejects synchronous owner reentry at %s publication before next RPC", async boundary => {
    const { c, calls } = fixture(); let triggered = false;
    const stop = effect(() => {
      const sides = c.state.value.sides;
      const hit = boundary === "initial" ? sides.length > 0 : boundary === "busy" ? sides.some(s => s.busy) : sides.some(s => s.anchor);
      if (!triggered && hit) { triggered = true; c.context("owner-b", true); }
    });
    try { await c.refresh(family()); expect(triggered).toBe(true); expect(calls).toHaveLength(boundary === "metadata" ? 2 : 0); expect(c.state.value.sides).toEqual([]); } finally { stop(); }
  });
  it.each(["usage", "body"])("does not send %s after its synchronous budget/busy publication changes owner", async kind => {
    const { c, calls } = fixture(); await c.refresh(family()); let triggered = false;
    const stop = effect(() => {
      const state = c.state.value; const body = c.body.value;
      if (!triggered && (kind === "usage" ? state.sides.some(s => s.usageCalls > 0) : body.busy)) { triggered = true; c.context("owner-b", true); }
    });
    try { if (kind === "usage") await c.usage(0); else await c.openBody(0,"anchor"); expect(triggered).toBe(true); expect(calls).toHaveLength(4); expect(c.state.value.sides).toEqual([]); } finally { stop(); }
  });

  it.each(["pair", "page", "route"])("initial side publication invalidation by %s starts zero RPCs", async boundary => {
    const { c, calls } = fixture(); let triggered = false;
    const stop = effect(() => {
      if (!triggered && c.state.value.sides.length) { triggered = true; if (boundary === "pair") c.choose("b"); else if (boundary === "page") c.pageChanged(); else c.context("owner-a/another-route", true); }
    });
    try { await c.refresh(family()); expect(calls).toHaveLength(0); expect(c.state.value.sides).toEqual([]); } finally { stop(); }
  });

  it("old settlements cannot clear fresh busy/capacity after owner transition", async () => {
    const { c, calls, handle, normal } = fixture(); const old: (() => void)[] = [];
    handle((kind,args) => new Promise(resolve => old.push(() => resolve(normal(kind,args)))));
    const pending = c.refresh(family()); c.context("B",true); c.choose("a"); c.choose("b");
    old.forEach(f => f()); await pending;
    const fresh: (() => void)[] = [];
    handle((kind,args) => new Promise(resolve => fresh.push(() => resolve(normal(kind,args)))));
    const p = c.refresh(family()); await tick(); expect(c.state.value.sides.every(s => s.busy)).toBe(true);
    await c.refresh(family()); expect(calls).toHaveLength(4);
    c.leave(); fresh.forEach(f => f()); await p; expect(c.state.value.sides).toEqual([]);
  });
  it("owner ABA during initial publish does not revive old invocation", async () => {
    const { c, calls } = fixture(); let once = false;
    const stop = effect(() => { if (!once && c.state.value.sides.length) { once = true; c.context("B",true); c.context("owner-a/branches/a",true); } });
    try { await c.refresh(family()); expect(calls).toHaveLength(0); } finally { stop(); }
  });

  it.each(["initial", "busy", "point", "window", "usage", "body"].flatMap(boundary => ["B", "ABA", "leave", "pair", "unknownSame", "unchanged"].map(transition => ({ boundary, transition }))))("inventory $boundary x $transition keeps old dispatch/projection fenced", async ({ boundary, transition }) => {
    const { c, calls } = fixture();
    if (boundary === "usage" || boundary === "body") await c.refresh(family());
    let hit = false; let transientCleared = false;
    const stop = effect(() => {
      const state = c.state.value; const body = c.body.value;
      const reachable = boundary === "initial" ? state.sides.length > 0 : boundary === "busy" ? state.sides.some(s => s.busy) : boundary === "point" ? state.sides.some(s => s.anchor) : boundary === "window" ? state.sides.some(s => s.pages.length) : boundary === "usage" ? state.sides.some(s => s.usageCalls) : body.busy;
      if (!hit && reachable) {
        hit = true;
        if (transition === "B") c.context("B",true);
        else if (transition === "ABA") { c.context("B",true); c.context("owner-a/branches/a",true); }
        else if (transition === "leave") c.leave();
        else if (transition === "pair") c.choose("b");
        else if (transition === "unknownSame") { c.context("",false); c.context("owner-a/branches/a",true); }
        if (transition !== "unchanged") transientCleared = !c.state.peek().sides.length && !c.body.peek().text && !c.body.peek().busy;
      }
    });
    try {
      if (boundary === "usage") await c.usage(0); else if (boundary === "body") await c.openBody(0,"anchor"); else await c.refresh(family());
      expect(hit).toBe(true);
      if (transition === "unchanged") expect(calls).toHaveLength(boundary === "usage" || boundary === "body" ? 5 : 4);
      else {
        expect(transientCleared).toBe(true); expect(c.state.value.sides).toEqual([]); expect(c.body.value.text).toBe("");
        expect(calls).toHaveLength(boundary === "initial" || boundary === "busy" ? 0 : boundary === "point" ? 2 : 4);
      }
    } finally { stop(); c.leave(); }
  });
  it("notification refresh reentry issues only the explicit new invocation, not old pair continuation", async () => {
    const { c, calls } = fixture(); let once = false; let fresh: Promise<void> | undefined;
    const stop = effect(() => { if (!once && c.state.value.sides.length) { once = true; fresh = c.refresh(family()); } });
    try { await c.refresh(family()); await fresh; expect(calls).toHaveLength(4); const cancel = calls[0]!.cancel; expect(calls.every(x => x.cancel === cancel)).toBe(true); expect(cancel.cancelled).toBe(false); } finally { stop(); c.leave(); }
  });

  it.each(["usageResult", "bodyResult", "usageFailure", "bodyFailure", "error", "finally", "resetBody", "resetState", "cancelCallback"].flatMap(boundary => ["B", "ABA", "leave", "pair", "unknownSame", "unchanged"].map(transition => ({ boundary, transition }))))("inventory terminal/reset $boundary x $transition owns only its admission", async ({ boundary, transition }) => {
    const { c, calls, handle, normal } = fixture();
    const result = boundary === "usageResult" || boundary === "bodyResult" || boundary === "usageFailure" || boundary === "bodyFailure";
    const reset = boundary === "resetBody" || boundary === "resetState" || boundary === "cancelCallback";
    if (result || reset) await c.refresh(family());
    if (boundary === "resetBody") await c.openBody(0,"anchor");
    if (boundary === "error" || boundary === "usageFailure" || boundary === "bodyFailure") handle(() => ({ ok:false, error:{ message:"read failed" } }));
    let hit = false; let cleared = false;
    const transitionNow = () => {
      hit = true;
      if (transition === "B") c.context("B",true);
      else if (transition === "ABA") { c.context("B",true); c.context("owner-a/branches/a",true); }
      else if (transition === "leave") c.leave();
      else if (transition === "pair") c.choose("b");
      else if (transition === "unknownSame") { c.context("",false); c.context("owner-a/branches/a",true); }
      if (transition !== "unchanged") cleared = !c.state.peek().sides.length && !c.body.peek().busy && !c.body.peek().text;
    };
    const stop = boundary === "cancelCallback" ? (() => { calls[0]!.cancel.add(transitionNow); return () => {}; })() : effect(() => {
      const state = c.state.value; const body = c.body.value;
      const reached = boundary === "usageFailure" ? state.sides.some(s => s.error) : boundary === "bodyFailure" ? body.unavailable : boundary === "usageResult" ? state.sides.some(s => s.usage) : boundary === "bodyResult" ? body.pages > 0 : boundary === "error" ? state.sides.some(s => s.error) : boundary === "finally" ? state.sides.some(s => !s.busy && s.pages.length) : boundary === "resetBody" ? !body.node : !state.sides.length;
      if (!hit && reached) transitionNow();
    });
    try {
      if (boundary === "usageResult" || boundary === "usageFailure") await c.usage(0); else if (boundary === "bodyResult" || boundary === "bodyFailure") await c.openBody(0,"anchor"); else if (reset) c.pageChanged(); else await c.refresh(family());
      expect(hit).toBe(true);
      if (transition !== "unchanged") { expect(cleared).toBe(true); expect(c.state.value.sides).toEqual([]); expect(c.body.value.text).toBe(""); }
      const expected = result || boundary === "resetBody" ? 5 : boundary === "error" ? 2 : 4;
      expect(calls).toHaveLength(expected);
    } finally { stop(); c.leave(); handle(normal); }
  });

});
