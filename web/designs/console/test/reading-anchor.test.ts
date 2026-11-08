// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ReadingAnchor } from "../screens/scrollIntent";

function element(top: number, height: number, dataset: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("div");
  Object.assign(el.dataset, dataset);
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
  return el;
}
describe("measured reading anchors", () => {
  it("preserves a row across prepend without assuming the caption height", () => {
    const box = element(50, 600), row = element(152, 80, { node: "n1" }); row.className = "vrow"; box.append(row);
    const anchor = new ReadingAnchor(); anchor.capture(box);
    row.getBoundingClientRect = () => ({ top: 1152, bottom: 1232, height: 80 }) as DOMRect;
    expect(anchor.correction(box)).toBe(1000);
  });
  it("finds a regrouped tool heading by an overlapping execution without retaining DOM nodes", () => {
    const box = element(50, 600), row = element(90, 40, { node: "old", members: '["e1"]' }); row.className = "vrow"; box.append(row);
    const anchor = new ReadingAnchor(); anchor.capture(box);
    row.remove();
    const merged = element(120, 40, { node: "new", members: '["e0","e1"]' }); merged.className = "vrow"; box.append(merged);
    expect(anchor.correction(box)).toBe(30);
  });
  it("anchors an expanded inner step even when its group moves to a different ordinal", () => {
    const box = element(50, 600), row = element(-300, 1000, { node: "old", members: '["e1"]' }); row.className = "vrow";
    const step = element(-40, 800, { scrollKey: "e1" }); row.append(step); box.append(row);
    const anchor = new ReadingAnchor(); anchor.capture(box);
    row.dataset.node = "new";
    step.getBoundingClientRect = () => ({ top: 60, bottom: 860, height: 800 }) as DOMRect;
    expect(anchor.correction(box)).toBe(100);
  });
  it("leaves removed anchors to the model's node/ordinal recovery", () => {
    const box = element(50, 600), row = element(90, 40, { node: "gone" }); row.className = "vrow"; box.append(row);
    const anchor = new ReadingAnchor(); anchor.capture(box); row.remove();
    expect(anchor.correction(box)).toBeUndefined();
  });
});
