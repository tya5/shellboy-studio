import { describe, expect, it } from "vitest";
import { PageRun } from "../src/page-run";
import { ShellboyData } from "../src/store";
import { FakeTransport, flush } from "./harness";

describe("PageRun continuation", () => {
  it("allows more past the replay budget without claiming the row cap", async () => {
    const pages = new PageRun<number>(new ShellboyData({ transport: new FakeTransport() }), n => n, "bad cursor");
    let hint = () => {};
    let reads = 0;
    pages.observe(notify => { hint = notify; return { close() {} }; }, async cursor => {
      ++reads;
      const index = Number(cursor ?? 0);
      return { ok: true, value: { page: index < 130 ? { items: [], next_cursor: String(index + 1) } : { items: [1] } } };
    });
    await flush();
    for (let i = 0; i < 129; i++) await pages.more();
    expect(pages.state.value).toMatchObject({ items: [], cursor: "130", capped: false, complete: false });
    await pages.more();
    expect(pages.state.value).toMatchObject({ items: [1], capped: false, complete: true });
    const beforeHint = reads;
    hint(); await flush(512);
    expect(reads - beforeHint).toBe(128);
    expect(pages.state.value).toMatchObject({ cursor: "128", capped: false, complete: false });
    pages.close();
  });
});
