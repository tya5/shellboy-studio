import { expect, it } from "vitest";
import { ownMessageHeldBy } from "../src/own-send-presentation";
import type { PendingReply } from "../../data/src/protocol";

const row = (message_id: string, held_by?: PendingReply["held_by"]): PendingReply => ({
  message_id, created_at: "now", asked_by: null, sender: { kind: "human" },
  recipient: { kind: "thread", thread_id: "thread" }, excerpt: "held", ...(held_by ? { held_by } : {}),
});

it("uses only the exact queue message and exposes typed foreground targets", () => {
  const rows = [row("other", { kind: "foreground_shell", execution_id: "wrong" }), row("mine", { kind: "foreground_shell", execution_id: "exec-exact" })];
  expect(ownMessageHeldBy("mine", rows)).toEqual({ kind: "foreground_shell", executionId: "exec-exact" });
  expect(ownMessageHeldBy("missing", rows)).toBeUndefined();
  expect(ownMessageHeldBy(undefined, rows)).toBeUndefined();
});

it.each(["response_generation", "run_completion", "recovery_wait"] as const)("preserves typed %s reason", kind => {
  expect(ownMessageHeldBy("mine", [row("mine", { kind })])).toEqual({ kind });
});

it("does not make an actionable claim for unknown or absent reasons", () => {
  expect(ownMessageHeldBy("mine", [row("mine", { kind: "unknown" })])).toBeUndefined();
  expect(ownMessageHeldBy("mine", [row("mine")])).toBeUndefined();
});
