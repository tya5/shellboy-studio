import { HistoryWindowInput } from "../src/history-input";

/** Test fixtures cross the same producer-owned decoder boundary as Operations. */
export function ownedHistory(raw: unknown): HistoryWindowInput {
  const out = HistoryWindowInput.decode(raw);
  if (!out.ok) throw new Error(`invalid owned history fixture: ${out.error.message}`);
  return out.value;
}
