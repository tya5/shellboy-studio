import { expect, it } from "vitest";
import { managementStop } from "../src/management-stop";

const thread = { thread_id: "A", run_id: "run-a", turn_id: "turn-a", title: "A", cwd: "/", connection: "c", model: "m", shells_count: 0 };
const run = { run_id: "run-a", thread_id: "A", turn_id: "turn-a", state: "live" as const };
const turn = { turn_id: "turn-a", run_id: "run-a", thread_id: "A", state: "running" as const };

it("performs one exact Stop wire after held exact preflight", async () => {
  const calls: string[] = [];
  const ops = {
    threadGet: async () => { calls.push("thread.get"); return { ok: true as const, value: thread }; },
    runGet: async () => { calls.push("run.get"); return { ok: true as const, value: run }; },
    turnGet: async () => { calls.push("turn.get"); return { ok: true as const, value: turn }; },
    runStop: async (id: string) => { calls.push(`run.stop:${id}`); return { ok: true as const, value: {} }; },
  };
  const result = await managementStop(ops, "A", { runId: "run-a", turnId: "turn-a" }, () => true);
  expect(result.kind).toBe("sent");
  expect(calls).toEqual(["thread.get", "run.get", "turn.get", "run.stop:run-a"]);
});

it("invalidates before mutation and emits zero Stop writes", async () => {
  const calls: string[] = [];
  let current = true;
  const ops = {
    threadGet: async () => { calls.push("thread.get"); return { ok: true as const, value: thread }; },
    runGet: async () => { calls.push("run.get"); return { ok: true as const, value: run }; },
    turnGet: async () => { calls.push("turn.get"); current = false; return { ok: true as const, value: turn }; },
    runStop: async () => { calls.push("run.stop"); return { ok: true as const, value: {} }; },
  };
  expect((await managementStop(ops, "A", { runId: "run-a", turnId: "turn-a" }, () => current)).kind).toBe("stale");
  expect(calls).toEqual(["thread.get", "run.get", "turn.get"]);
});
