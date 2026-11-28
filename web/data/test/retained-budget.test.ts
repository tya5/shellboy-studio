import { describe, expect, it } from "vitest";
import { RetainedBudget, retainedStringBytes } from "../src/retained-budget";

const body = "a".repeat(256);
const charge = retainedStringBytes(body);

function fixture(limit: number) {
  const budget = new RetainedBudget(limit);
  const bodies = new Map<string, { value: string; touch(): void; pin(): () => void }>();
  const reads: string[] = [];
  const read = (key: string) => {
    const hit = bodies.get(key);
    if (hit) { hit.touch(); return hit; }
    reads.push(key);
    const ticket = budget.reserve(charge, () => { bodies.delete(key); });
    if (!ticket) return;
    const entry = { value: body, touch: ticket.touch, pin: ticket.pin };
    bodies.set(key, entry);
    return entry;
  };
  return { budget, bodies, reads, read };
}

describe("shared retained budget", () => {
  it("reuses resident data and gives a revisit priority over the oldest cold entry", () => {
    const { read, reads, bodies } = fixture(1500);
    read("history");
    read("catalog");
    expect(read("history")?.value).toBe(body);
    expect(reads).toEqual(["history", "catalog"]);
    read("shell");
    expect([...bodies.keys()]).toEqual(["history", "shell"]);
    expect(read("catalog")?.value).toBe(body);
    expect(reads).toEqual(["history", "catalog", "shell", "catalog"]);
  });

  it("keeps pins through pressure until the last reader releases them", () => {
    const { budget, read, bodies } = fixture(1500);
    const entry = read("open detail")!;
    const closeDetail = entry.pin(), closeWindow = entry.pin();
    read("cold");
    budget.setLimit(0);
    expect([...bodies.keys()]).toEqual(["open detail"]);
    expect(budget.usage.value.pinned).toBe(budget.usage.value.used);
    expect(read("new")).toBeUndefined();
    closeDetail();
    closeDetail();
    expect(bodies.has("open detail")).toBe(true);
    closeWindow();
    expect(bodies.size).toBe(0);
    expect(budget.usage.value).toEqual({ used: 0, pinned: 0 });
  });
});
