import { ConversationWindow } from "../src/window";
import { expect, it } from "vitest";
import { ShellboyData } from "../../data/src/store";
import { connected, FakeTransport, flush } from "../../data/test/harness";
async function rig() {
  const t = new FakeTransport(); let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `qualification-${++n}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); await flush();
  return { t, data, a: data.openThread("a"), b: data.openThread("a") };
}
it("ordinary accepted-reference/read/geometry work preserves handle qualification without qualification RPCs", async () => {
  const r = await rig(), before = r.t.calls().length, token = r.a.captureReadQualification()!;
  expect(r.a.isReadQualificationCurrent(token)).toBe(true); expect(r.t.calls().length).toBe(before);
  const w = new ConversationWindow({ read: (args, cancel) => r.a.readWindow(args, cancel) });
  await flush(); const call = r.t.calls("history.window").at(-1)!;
  r.t.ok(call.id, { thread_id: "a", revision: 1, total: 1, items: [{ node_id: "n", kind: "user", items: [{ kind: "text", item_identity: "i", text: "saved", text_complete: true }], selection: { ordinal: 0 } }] });
  await flush(); const ref = w.acceptedView.peek();
  expect(ref.total).toBe(1); w.measure([[0, 123]]);
  expect(w.acceptedView.peek()).not.toBe(ref); expect(r.a.isReadQualificationCurrent(token)).toBe(true);
  w.dispose(); r.a.pause(); r.a.close(); expect(r.a.isReadQualificationCurrent(token)).toBe(false); r.data.stop();
});
