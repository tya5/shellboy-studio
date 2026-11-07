import { describe, expect, it } from "vitest";
import { connected, FakeTransport, flush } from "../../data/test/harness";
import { ShellboyData } from "../../data/src";
import { TilePreviews } from "../src/tiles";

async function setup(capability = true) {
  const t = new FakeTransport(); const data = new ShellboyData({ transport: t, newId: () => "id" });
  data.start(); t.open();
  if (connected.state !== "connected") throw new Error("fixture");
  t.push({ t: "hello", bridge_version: "test", owner: { ...connected, info: { ...connected.info, capabilities: capability ? ["history.window"] : [] } } });
  await flush(); return { t, data, tiles: new TilePreviews(data) };
}
async function answer(t: FakeTransport) {
  const seen = new Set<number>();
  for (let i = 0; i < 100; i++) {
    await flush();
    const calls = t.calls().filter((c) => !seen.has(c.id));
    if (!calls.length) return;
    for (const c of calls) {
      seen.add(c.id);
      t.ok(c.id, c.command === "history.window" ? { thread_id: String((c.args as { thread_id: string }).thread_id), revision: 1, total: 1, items: [{ node_id: "n", kind: "user", excerpt: "hello", selection: { ordinal: 0 } }] } : { items: [] });
    }
  }
}
describe("visible tile reads", () => {
  it("bounds 20 visible tiles, counts reads, follows hints and stops on close", async () => {
    const { t, data, tiles } = await setup();
    for (let i = 0; i < 21; i++) tiles.show(String(i));
    expect(t.calls("history.window")).toHaveLength(4);
    await answer(t);
    expect(t.calls("history.window")).toHaveLength(20);
    expect(t.calls("shell.list")).toHaveLength(20);
    expect(t.calls("history.list")).toHaveLength(0);
    expect(tiles.previews.value.size).toBe(20);
    expect(t.calls("history.window")[0]!.args).toMatchObject({ before: 19, after: 0, excerpt_chars: 160 });
    t.push({ t: "changed", thread_ids: ["0"], list: false }); await answer(t);
    expect(t.calls("history.window")).toHaveLength(21);
    expect(t.calls("shell.list")).toHaveLength(21);
    tiles.hide("0"); t.push({ t: "changed", thread_ids: ["0"], list: false }); await flush();
    expect(t.calls("history.window")).toHaveLength(21);
    tiles.close(); data.stop();
  });
  it("cancels superseded reads and ignores unsupported owners", async () => {
    const { t, data, tiles } = await setup();
    tiles.show("a"); await flush(); const id = t.calls("history.window")[0]!.id;
    t.push({ t: "changed", thread_ids: ["a"], list: false }); await flush();
    expect(t.cancels()).toContain(id);
    tiles.close(); data.stop();
    const old = await setup(false); old.tiles.show("a"); await flush();
    expect(old.t.calls()).toHaveLength(0); old.tiles.close(); old.data.stop();
  });
});
