import { describe, expect, it } from "vitest";
import { statusCharacter } from "../screens/Conversation";

describe("conversation characters", () => {
  it("maps only explicit owner states to character variants", () => {
    expect(["running", "waiting", "awaiting", "recovery", "failed", "completed", "stopped", "idle", "unknown"].map(statusCharacter)).toEqual(["thinking", "thinking", "ask", "error", "error", "complete-check", "rest", "rest", "neutral"]);
  });
});
