import { expect, it } from "vitest";
import { Handoff } from "../src/handoff";
import { flush } from "./harness";

const frame = (attempt_id: string) => ({ attempt_id, gap: false, deltas: [{ offset: 0, reasoning: false, text: attempt_id }] });

it("publishes one immutable placement transition and preserves unrelated record identity", async () => {
  const handoff = new Handoff(callback => queueMicrotask(callback));
  const seen: (readonly unknown[])[] = [];
  handoff.records.subscribe(records => seen.push(records));
  handoff.apply(frame("A"));
  handoff.apply(frame("B"));
  handoff.apply(frame("C"));
  await flush();
  const before = handoff.records.peek(), recordA = before[0]!, recordB = before[1]!, recordC = before[2]!;
  const beforePlacementNotifications = seen.length;
  handoff.placeAfter("A", "saved-a");
  await flush();
  const placed = handoff.records.peek();
  expect(placed).not.toBe(before);
  expect(placed[0]).not.toBe(recordA);
  expect(placed[0]?.placement).toEqual({ afterNodeId: "saved-a" });
  expect(Object.isFrozen(placed[0])).toBe(true);
  expect(Object.isFrozen(placed[0]?.placement)).toBe(true);
  expect(placed[1]).toBe(recordB);
  expect(placed[2]).toBe(recordC);
  expect(seen.length).toBe(beforePlacementNotifications + 1);
  const afterFirstPlacement = seen.length;
  handoff.placeAfter("A", "ignored-second-placement");
  await flush();
  expect(handoff.records.peek()).toBe(placed);
  expect(seen.length).toBe(afterFirstPlacement);
});
