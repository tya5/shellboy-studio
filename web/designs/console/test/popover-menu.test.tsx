// @vitest-environment happy-dom
import "../system/components.css";
import "../system/tokens/console.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { Menu, Popover } from "../system/components";
import { placePanel } from "../system/components/Popover";

it("outside dismissal leaves focus alone", async () => {
  const host = document.createElement("div");
  const anchor = document.createElement("button");
  document.body.append(host, anchor);
  let open = true;
  const draw = () => render(<Popover open={open} anchor={anchor} onClose={() => { open = false; draw(); }}><span>content</span></Popover>, host);
  const outside = document.createElement("button");
  document.body.append(outside);
  await act(async () => { draw(); await Promise.resolve(); });
  outside.focus();
  expect(document.body.querySelector(".popover")).not.toBeNull();
  await act(async () => { outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await Promise.resolve(); });
  expect(document.body.querySelector(".popover")).toBeNull();
  expect(document.activeElement).toBe(outside);
  render(null, host); host.remove(); anchor.remove(); outside.remove();
});

it("opens Menu with the first item focused and wraps keyboard navigation", async () => {
  const host = document.createElement("div");
  const anchor = document.createElement("button");
  document.body.append(host, anchor);
  let selected = "";
  act(() => render(<Menu open anchor={anchor} onClose={() => {}} entries={[{ key: "one", label: "One", onSelect: () => { selected = "one"; } }, { key: "two", label: "Two", onSelect: () => { selected = "two"; } }]} />, host));
  await act(async () => { await Promise.resolve(); });
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  expect(document.activeElement).toBe(items[0]);
  items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  expect(document.activeElement).toBe(items[1]);
  items[1]!.click();
  expect(selected).toBe("two");
  render(null, host); host.remove(); anchor.remove();
});

it("places measured panels within a narrow viewport and flips above", () => {
  const gutter = 12;
  const narrow = placePanel({ left: 280, right: 320, top: 40, bottom: 64 }, { width: 280, height: 32 }, { width: 320, height: 768 }, gutter);
  expect(narrow.left).toBeGreaterThanOrEqual(gutter);
  expect(narrow.left + 280).toBeLessThanOrEqual(320 - gutter);
  expect(narrow.top).toBe(64);
  const short = placePanel({ left: 100, right: 200, top: 100, bottom: 124 }, { width: 100, height: 32 }, { width: 320, height: 768 }, gutter);
  expect(short.left).toBe(100);
  const flipped = placePanel({ left: 100, right: 200, top: 740, bottom: 764 }, { width: 100, height: 80 }, { width: 320, height: 768 }, gutter);
  expect(flipped.top).toBe(660);
});
