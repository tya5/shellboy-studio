import { describe, expect, it } from "vitest";
import { Refresher } from "../src/refresher";
import { flush } from "./harness";

function setup() {
  const started: string[] = [];
  const gates: (() => void)[] = [];
  const sentHooks: (() => void)[] = [];
  const r = new Refresher((key, onSent) => {
    started.push(key);
    sentHooks.push(onSent);
    return new Promise<void>((resolve) => gates.push(resolve));
  });
  return { r, started, gates, sentHooks };
}

describe("Refresher", () => {
  it("merges requests made before the read is on the wire", async () => {
    const { r, started, gates } = setup();
    const a = r.request("k");
    const b = r.request("k");
    expect(a).toBe(b);
    gates[0]!();
    await a;
    expect(started).toEqual(["k"]);
    expect(r.active).toBe(0);
  });

  it("schedules exactly one more read for any number of requests during a running read", async () => {
    const { r, started, gates, sentHooks } = setup();
    const done = r.request("k");
    sentHooks[0]!();
    r.request("k");
    r.request("k");
    r.request("k");
    gates[0]!();
    await flush();
    expect(started).toEqual(["k", "k"]);
    gates[1]!();
    await done;
    expect(started).toHaveLength(2);
  });

  it("keeps targets independent", async () => {
    const { r, started } = setup();
    void r.request("a");
    void r.request("b");
    expect(started).toEqual(["a", "b"]);
  });
});
