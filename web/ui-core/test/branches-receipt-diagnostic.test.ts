// Characterization of public 1f26 gaps, not acceptance of safe retries.
// A sent mutation is applied to synthetic state before its reply is dropped.
import { describe, expect, it } from "vitest";
import { Link } from "../../data/src/link";
import { Operations } from "../../data/src/operations";
import { FakeTransport, flush } from "../../data/test/harness";
import { Branches } from "../src/branching";
import { fixtureRewind } from "./fixture";

function fixture() {
  const t = new FakeTransport(); const link = new Link(t); link.start(); t.open();
  let seq = 0; const ops = new Operations(link, () => `receipt-${++seq}`);
  const b = new Branches(ops);
  const target = { threadId: "selected", nodeId: "split" };
  b.target.value = target;
  return { t, link, ops, b, target };
}
async function ready(f: ReturnType<typeof fixture>) {
  const p = f.b.previewRewind(f.target);
  f.t.ok(f.t.calls("thread.rewind").at(-1)!.id, fixtureRewind); await p;
}

describe("public Branches receipt gaps (diagnostic, unresolved)", () => {
  for (const changed of [false, true]) it(`rename reply loss currently issues a fresh ID (${changed ? "changed" : "same"} text)`, async () => {
    const f = fixture(); const state = new Map([["selected", "old"], ["parent", "untouched"]]);
    const first = f.b.renameBranch("selected", "name"); const sent = f.t.calls("thread.set")[0]!;
    state.set("selected", "name"); // accepted by synthetic owner; response lost
    f.t.drop(); await first; expect(f.b.actionError.value).toBeTruthy();
    f.t.open();
    // An explicit status observation may be unknown; the Branches model does not retain it.
    const status = f.ops.operationGet(sent.operation_id!); const get = f.t.calls("operation.get")[0]!;
    f.t.ownerError(get.id, "operation_not_found"); expect((await status).ok).toBe(false);
    const retry = f.b.renameBranch("selected", changed ? "different" : "name");
    const resent = f.t.calls("thread.set")[1]!;
    expect(resent.operation_id).not.toBe(sent.operation_id);
    expect(resent.args).toEqual({ thread_id: "selected", title: changed ? "different" : "name" });
    f.t.drop(); await retry; expect(state.get("parent")).toBe("untouched"); f.b.leave(); f.link.stop();
  });

  it("archive accepted/reply lost retains selection but retry loses identity; parent is not targeted", async () => {
    const f = fixture(); f.b.toggleBranch("selected"); const archived = new Set<string>();
    const first = f.b.archiveSelected(); const sent = f.t.calls("thread.archive")[0]!;
    expect(sent.args).toEqual({ thread_ids: ["selected"] }); archived.add("selected");
    f.t.drop(); await first; expect([...f.b.selection.value]).toEqual(["selected"]);
    f.t.open(); const retry = f.b.archiveSelected(); const resent = f.t.calls("thread.archive")[1]!;
    expect(resent.operation_id).not.toBe(sent.operation_id); expect(resent.args).toEqual(sent.args);
    expect(archived.has("parent")).toBe(false); f.t.drop(); await retry; f.b.leave(); f.link.stop();
  });

  it("rewind accepted/reply lost allows fresh-ID retry and changed follow-up text", async () => {
    const f = fixture(); await ready(f); let applied = 0;
    const first = f.b.confirmRewind("original"); const sent = f.t.calls("thread.rewind")[1]!; applied++;
    f.t.drop(); await first; expect(f.b.rewind.value.kind).toBe("failed");
    f.t.open(); const retry = f.b.confirmRewind("changed"); const resent = f.t.calls("thread.rewind")[2]!;
    expect(resent.operation_id).not.toBe(sent.operation_id);
    expect(resent.args).toEqual(sent.args); applied++;
    f.t.ok(resent.id, { ...fixtureRewind, dry_run: false, branch_thread_id: "kept" }); await flush();
    const send = f.t.calls("message.send")[0]!;
    expect(send.args).toEqual({ thread_id: "selected", text: "changed" }); expect(applied).toBe(2);
    f.t.drop(); await retry; f.b.leave(); f.link.stop();
  });

  for (const lost of [false, true]) it(`rewind success + send ${lost ? "reply loss" : "refusal"} does not repeat rewind but loses follow-up receipt`, async () => {
    const f = fixture(); await ready(f);
    const p = f.b.confirmRewind("follow-up"); const rewind = f.t.calls("thread.rewind")[1]!;
    f.t.ok(rewind.id, { ...fixtureRewind, dry_run: false, branch_thread_id: "kept" }); await flush();
    const send = f.t.calls("message.send")[0]!;
    expect(send.args).toEqual({ thread_id: "selected", text: "follow-up" });
    if (lost) f.t.drop(); else f.t.ownerError(send.id, "thread_busy");
    await p; expect(f.b.rewind.value.kind).toBe("idle"); expect(f.b.actionError.value).toContain("Rewind succeeded; request not sent:");
    await f.b.confirmRewind("changed");
    expect(f.t.calls("thread.rewind").filter(c => !(c.args as {dry_run?:boolean}).dry_run)).toHaveLength(1);
    expect(f.t.calls("message.send")).toHaveLength(1);
    // Family reread clears rewind state to idle, discarding its completed facts.
    // No retained send outcome API: accepted-but-unconfirmed must not be called 'not sent'.
    if (lost) expect(f.t.calls("operation.get")).toHaveLength(0);
    f.b.leave(); f.link.stop();
  });
});
