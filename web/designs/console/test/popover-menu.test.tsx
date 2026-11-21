// @vitest-environment happy-dom
import "../system/components.css";
import "../system/tokens/console.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { Menu, Popover } from "../system/components";

it("renders Popover in the document layer and restores its anchor on outside close", async () => {
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
  await act(async () => { document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); await Promise.resolve(); });
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

it("keeps a wide menu inside a narrow viewport", async () => {
  const host = document.createElement("div");
  const anchor = document.createElement("button");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
  anchor.getBoundingClientRect = () => ({ left: 280, right: 310, top: 40, bottom: 64, width: 30, height: 24, x: 280, y: 40, toJSON: () => ({}) });
  document.body.append(host, anchor);
  act(() => render(<Popover open anchor={anchor} onClose={() => {}}><span>Short</span></Popover>, host));
  await act(async () => { await Promise.resolve(); });
  const panel = document.body.querySelector<HTMLElement>(".popover")!;
  Object.defineProperty(panel, "getBoundingClientRect", { value: () => ({ left: 12, right: 292, width: 280, top: 64, bottom: 96, height: 32, x: 12, y: 64, toJSON: () => ({}) }) });
  window.dispatchEvent(new Event("resize"));
  const rect = panel.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(12);
  expect(rect.right).toBeLessThanOrEqual(320 - 12);
  expect(rect.width).toBeLessThan(320 - 24);
  render(null, host); host.remove(); anchor.remove();
});
