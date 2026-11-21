// @vitest-environment happy-dom
import "../system/components.css";
import "../system/tokens/console.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it } from "vitest";
import { MoreMenu } from "../system/components/MoreMenu";
import { MonitorPopover } from "../system/components/MonitorPopover";
import { ChoiceList } from "../system/components/ChoiceList";

it("renders the More trigger before controlled links and closes when focus leaves", async () => {
  const host = document.createElement("div");
  const outside = document.createElement("button");
  document.body.append(host, outside);
  act(() => render(<MoreMenu label="More" items={[{ key: "apps", href: "#apps", icon: "apps", label: "Apps", current: false }]} />, host));
  const trigger = host.querySelector<HTMLButtonElement>(".more-tab > button")!;
  act(() => trigger.click());
  await act(async () => { await Promise.resolve(); });
  const panel = host.querySelector<HTMLElement>(".more-panel")!;
  const link = panel.querySelector<HTMLAnchorElement>("a")!;
  expect(trigger.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  expect(link.tabIndex).not.toBe(-1);
  link.focus(); outside.focus();
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector(".more-panel")).toBeNull();
  render(null, host); host.remove(); outside.remove();
});

it("Escape closes a hover-preview MonitorPopover", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => render(<MonitorPopover label="View" preview><span>preview options</span></MonitorPopover>, host));
  const root = host.querySelector<HTMLElement>(".monitor-popover")!;
  const trigger = root.querySelector<HTMLButtonElement>("button")!;
  await act(async () => { root.dispatchEvent(new MouseEvent("mouseenter")); await Promise.resolve(); });
  expect(root.querySelector(".monitor-popover-panel")).not.toBeNull();
  act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(root.querySelector(".monitor-popover-panel")).toBeNull();
  expect(document.activeElement).not.toBe(trigger);
  render(null, host); host.remove();
});

it("gives each ChoiceList group its own radio name even when labels match", () => {
  const host = document.createElement("div");
  act(() => render(<><ChoiceList label="Mode" choices={[{ value: "a", label: "A" }]} value="a" onChange={() => {}} /><ChoiceList label="Mode" choices={[{ value: "b", label: "B" }]} value="b" onChange={() => {}} /></>, host));
  const groups = [...host.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
  const names = groups.map((group) => group.querySelector<HTMLInputElement>('input[type="radio"]')!.name);
  expect(names[0]).not.toBe(names[1]);
  render(null, host); host.remove();
});
