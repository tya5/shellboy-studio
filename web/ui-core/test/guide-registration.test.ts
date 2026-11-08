import { describe, expect, it } from "vitest";
import { GuideRegistration } from "../src/guide-registration";
import { ShellboyData } from "../../data/src";
import { FakeTransport, connected, flush } from "../../data/test/harness";

async function setup() { const transport = new FakeTransport(); const data = new ShellboyData({ transport, newId: () => "id" }); data.start(); transport.open(); transport.push({ t: "hello", bridge_version: "test", owner: connected }); await flush(); return { transport, data, guide: new GuideRegistration(data.operations) }; }
function facts(paths?: string[]) { return { file: { valid: true, content_hash: "hash", values: paths === undefined ? {} : { extra_instructions: paths } } }; }
describe("common instruction pointer", () => {
  it("appends once preserving existing entries, then removes only itself", async () => {
    const { transport: t, data, guide } = await setup();
    guide.update("/data", true); await flush(); t.ok(t.calls("config.get").at(-1)!.id, facts(["/other"])); await flush();
    const write = t.calls("config.set").at(-1)!; expect(write.args).toEqual({ expected_hash: "hash", changes: [{ field: "extra_instructions", value: ["/other", "/data/studio/agent-pointer.md"] }] });
    t.ok(write.id, { applied_to_running_owner: true, restart_required: false }); await flush(); expect(guide.state.value).toMatchObject({ registered: true, applied: true, restart: false });
    guide.update("/data", true); await flush(); t.ok(t.calls("config.get").at(-1)!.id, facts(["/other", "/data/studio/agent-pointer.md"])); await flush(); expect(t.calls("config.set")).toHaveLength(1);
    guide.update("/data", false); await flush(); t.ok(t.calls("config.get").at(-1)!.id, facts(["/other", "/data/studio/agent-pointer.md"])); await flush();
    expect(t.calls("config.set").at(-1)!.args).toEqual({ expected_hash: "hash", changes: [{ field: "extra_instructions", value: ["/other"] }] });
    t.ok(t.calls("config.set").at(-1)!.id, {}); await flush(); data.stop();
  });
  it("does not write for older owners", async () => { const { transport: t, data, guide } = await setup(); guide.update("/data", true); await flush(); t.ok(t.calls("config.get").at(-1)!.id, facts()); await flush(); expect(t.calls("config.set")).toHaveLength(0); expect(guide.state.value.supported).toBe(false); data.stop(); });
});
