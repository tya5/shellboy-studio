import { describe, expect, it } from "vitest";
import { heldRange } from "../screens/WindowedScroll";

describe("loaded history around the viewport", () => {
  it("projects both sides of a cached window boundary", () => {
    const held = (i: number) => i >= 40 && i < 160;
    expect(heldRange({ first: 79, last: 81 }, 200, held)).toEqual({ first: 40, last: 159 });
    expect(heldRange({ first: 80, last: 82 }, 200, held)).toEqual({ first: 40, last: 159 });
  });
  it("does not cross an unloaded gap", () => {
    expect(heldRange({ first: 5, last: 6 }, 20, (i) => i >= 3 && i <= 8)).toEqual({ first: 3, last: 8 });
  });
});
