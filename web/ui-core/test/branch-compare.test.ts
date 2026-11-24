import { effect } from "@preact/signals-core";
import { describe, expect, it } from "vitest";
import { BranchCompare, anchorCandidate } from "../src/branch-compare";
import { readFamily } from "../src/branches";
import type { Operations } from "../../data/src";

const family = () => readFamily([{ thread_id: "a", root_thread_id: "a", items: [
  { thread_id: "a", branch_kind: "unknown", tip: { node_id: "a-tip" } },
  { thread_id: "b", parent_thread_id: "a", branch_kind: "fork", divergence: { node_id: "anchor", ordinal: 2 }, tip: { node_id: "b-tip" } },
  { thread_id: "c", parent_thread_id: "a", branch_kind: "rewind", divergence: { node_id: "other", ordinal: 9 } },
] }]);
const tick = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function fixture() {
  const calls: { kind: string; args: any; cancel: any }[] = [];
  let handler: ((kind: string, args: any) => Promise<any> | any) | undefined;
  const normal = (kind: string, args: any): any => {
    const start = args.ordinal ?? (args.thread_id === "a" ? 2 : 7);
    const length = args.node_id ? 1 : 50;
    return { ok: true, value: { thread_id: args.thread_id, revision: args.thread_id, total: 1000, items: Array.from({ length }, (_, n) => ({ node_id: n === 0 ? args.node_id ?? args.expect_node_id : `${args.thread_id}-${start + n}`, selection: { ordinal: start + n }, kind: "user", excerpt: "saved" })) } };
  };
  const ops = Object.fromEntries(["historyWindow"].map(kind => [kind, async (args: any, options: any) => {
    calls.push({ kind, args, cancel: options.cancel }); return handler ? handler(kind, args) : normal(kind, args);
  }])) as unknown as Operations;
  const c = new BranchCompare(ops);
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
  it.each(["owner-b", "owner-a/route/new", ""])("cancels and discards delayed anchor success after context %s", async context => {
    const { c, calls, handle, normal } = fixture(); const release: (() => void)[] = [];
    handle((kind, args) => new Promise(resolve => release.push(() => resolve(normal(kind, args)))));
    const pending = c.refresh(family()); expect(calls).toHaveLength(2);
    c.context(context, context !== ""); for (const done of release) done(); await pending;
    expect(calls).toHaveLength(2); expect(c.state.value.sides).toEqual([]); expect(calls.every(x => x.cancel.cancelled)).toBe(true);
  });
  it("owner ABA and leaving discard late errors without new requests", async () => {
    const { c, calls, handle } = fixture(); const release: (() => void)[] = [];
    handle(() => new Promise(resolve => release.push(() => resolve({ ok: false, error: { message: "late" } }))));
    const p = c.refresh(family()); c.context("B", true); c.context("owner-a/branches/a", true); c.leave();
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
  it("wrong-side anchor response and unsafe ordinal stop before excerpt RPC", async () => {
    const { c, calls, handle, normal } = fixture();
    handle((kind, args) => { const out = normal(kind, args); out.value.items[0].selection.ordinal = Number.MAX_SAFE_INTEGER + 1; return out; });
    await c.refresh(family()); expect(calls).toHaveLength(2); expect(c.state.value.sides.every(x => x.error === "anchorUnavailable")).toBe(true);
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

  it.each(["pair", "leave", "route"])("initial side publication invalidation by %s starts zero RPCs", async boundary => {
    const { c, calls } = fixture(); let triggered = false;
    const stop = effect(() => {
      if (!triggered && c.state.value.sides.length) { triggered = true; if (boundary === "pair") c.choose("b"); else if (boundary === "leave") c.leave(); else c.context("owner-a/another-route", true); }
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

  it.each(["initial", "busy", "point", "window"].flatMap(boundary => ["B", "ABA", "leave", "pair", "unknownSame", "unchanged"].map(transition => ({ boundary, transition }))))("inventory $boundary x $transition keeps old dispatch/projection fenced", async ({ boundary, transition }) => {
    const { c, calls } = fixture();
    let hit = false; let transientCleared = false;
    const stop = effect(() => {
      const state = c.state.value;
      const reachable = boundary === "initial" ? state.sides.length > 0 : boundary === "busy" ? state.sides.some(s => s.busy) : boundary === "point" ? state.sides.some(s => s.anchor) : state.sides.some(s => s.pages.length);
      if (!hit && reachable) {
        hit = true;
        if (transition === "B") c.context("B",true);
        else if (transition === "ABA") { c.context("B",true); c.context("owner-a/branches/a",true); }
        else if (transition === "leave") c.leave();
        else if (transition === "pair") c.choose("b");
        else if (transition === "unknownSame") { c.context("",false); c.context("owner-a/branches/a",true); }
        if (transition !== "unchanged") transientCleared = !c.state.peek().sides.length;
      }
    });
    try {
      await c.refresh(family());
      expect(hit).toBe(true);
      if (transition === "unchanged") expect(calls).toHaveLength(4);
      else {
        expect(transientCleared).toBe(true); expect(c.state.value.sides).toEqual([]);
        expect(calls).toHaveLength(boundary === "initial" || boundary === "busy" ? 0 : boundary === "point" ? 2 : 4);
      }
    } finally { stop(); c.leave(); }
  });
  it("notification refresh reentry issues only the explicit new invocation, not old pair continuation", async () => {
    const { c, calls } = fixture(); let once = false; let fresh: Promise<void> | undefined;
    const stop = effect(() => { if (!once && c.state.value.sides.length) { once = true; fresh = c.refresh(family()); } });
    try { await c.refresh(family()); await fresh; expect(calls).toHaveLength(4); const cancel = calls[0]!.cancel; expect(calls.every(x => x.cancel === cancel)).toBe(true); expect(cancel.cancelled).toBe(false); } finally { stop(); c.leave(); }
  });

  it.each(["error", "finally", "resetState", "cancelCallback"].flatMap(boundary => ["B", "ABA", "leave", "pair", "unknownSame", "unchanged"].map(transition => ({ boundary, transition }))))("inventory terminal/reset $boundary x $transition owns only its admission", async ({ boundary, transition }) => {
    const { c, calls, handle, normal } = fixture();
    const reset = boundary === "resetState" || boundary === "cancelCallback";
    if (reset) await c.refresh(family());
    if (boundary === "error") handle(() => ({ ok:false, error:{ message:"read failed" } }));
    let hit = false; let cleared = false;
    const transitionNow = () => {
      hit = true;
      if (transition === "B") c.context("B",true);
      else if (transition === "ABA") { c.context("B",true); c.context("owner-a/branches/a",true); }
      else if (transition === "leave") c.leave();
      else if (transition === "pair") c.choose("b");
      else if (transition === "unknownSame") { c.context("",false); c.context("owner-a/branches/a",true); }
      if (transition !== "unchanged") cleared = !c.state.peek().sides.length;
    };
    const stop = boundary === "cancelCallback" ? (() => { calls[0]!.cancel.add(transitionNow); return () => {}; })() : effect(() => {
      const state = c.state.value;
      const reached = boundary === "error" ? state.sides.some(s => s.error) : boundary === "finally" ? state.sides.some(s => !s.busy && s.pages.length) : !state.sides.length;
      if (!hit && reached) transitionNow();
    });
    try {
      if (reset) c.context("owner-a/branches/other", true); else await c.refresh(family());
      expect(hit).toBe(true);
      if (transition !== "unchanged") { expect(cleared).toBe(true); expect(c.state.value.sides).toEqual([]); }
      const expected = boundary === "error" ? 2 : 4;
      expect(calls).toHaveLength(expected);
    } finally { stop(); c.leave(); handle(normal); }
  });

});
