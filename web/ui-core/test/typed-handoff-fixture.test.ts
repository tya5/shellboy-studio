import { expect, it } from "vitest";
import { typedAttempt, typedHandoff, typedHistoryWindow, validTypedHandoff } from "./typed-handoff-fixture";

it("builds one strict receipt/owner history contract for node and ordinal reads", () => {
  const fixture = typedHandoff();
  const attempt = typedAttempt(fixture);
  const byNode = typedHistoryWindow(fixture, { node_id: fixture.nodeId });
  const byOrdinal = typedHistoryWindow(fixture, { ordinal: fixture.ordinal });
  expect(byNode).toEqual(byOrdinal);
  expect(byNode && validTypedHandoff(fixture, attempt, byNode)).toBe(true);
  expect(byNode?.items[0]?.items[0]?.text_complete).toBe(true);
  expect(byNode?.item_count).toBe(1);
});

it("rejects mismatched receipt identity and node ordinal", () => {
  const fixture = typedHandoff();
  const attempt = typedAttempt(fixture);
  const window = typedHistoryWindow(fixture, { node_id: fixture.nodeId })!;
  expect(validTypedHandoff(fixture, { ...attempt, response_nodes: [{ ...attempt.response_nodes[0], ordinal: 299 }] }, window)).toBe(false);
  expect(validTypedHandoff(fixture, attempt, { ...window, items: [{ ...window.items[0], selection: { ordinal: 299 } }] })).toBe(false);
  expect(typedHistoryWindow(fixture, { node_id: "wrong-node" })).toBeUndefined();
  expect(typedHistoryWindow(fixture, { ordinal: 299 })).toBeUndefined();
});
