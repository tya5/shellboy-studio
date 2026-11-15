import { expect, it } from "vitest";
import type { HistoryWindowResult } from "../src/protocol";
import { HistoryWindowInput } from "../src/history-input";

const raw: HistoryWindowResult = { thread_id: "t", revision: 1, total: 1, items: [] };
// @ts-expect-error Raw structural values must not bypass the owned decoder.
const bypass: HistoryWindowInput = raw;
// @ts-expect-error Joined pages must be individually decoded owned inputs.
const joinedBypass = HistoryWindowInput.join([raw]);
void bypass; void joinedBypass;

it("accepts decoded owned input and rejects raw structural bypasses at runtime", () => {
  const decoded = HistoryWindowInput.decode(raw);
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.value).toBeInstanceOf(HistoryWindowInput);
});
