// @vitest-environment happy-dom
import "../system/components.css";
import "../system/tokens/console.css";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { MoreMenu } from "../system/components/MoreMenu";
import { MonitorPopover } from "../system/components/MonitorPopover";
import { ChoiceList } from "../system/components/ChoiceList";

it("renders the More trigger before controlled links and closes when focus leaves", async () => {
  const host = document.createElement("div");
  const outside = document.createElement("button");
  document.body.append(host, outside);
  act(() => render(<MoreMenu label="More" items={[{ key: "apps", href: "#apps", role: "nav.apps", label: "Apps", current: false }]} />, host));
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

it("keeps same-labeled ChoiceList groups independent inside one form", () => {
  const host = document.createElement("div");
  const changeA = vi.fn();
  const changeB = vi.fn();
  act(() => render(<form><ChoiceList label="Mode" choices={[{ value: "a", label: "A" }, { value: "aa", label: "AA" }]} value="a" onChange={changeA} /><ChoiceList label="Mode" choices={[{ value: "b", label: "B" }, { value: "bb", label: "BB" }]} value="b" onChange={changeB} /></form>, host));
  const groups = [...host.querySelectorAll<HTMLElement>('[role="radiogroup"]')];
  const radios = groups.map((group) => [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]);
  expect(radios[0]![0]!.name).not.toBe(radios[1]![0]!.name);
  act(() => {
    radios[0]![1]!.click();
    radios[0]![1]!.dispatchEvent(new Event("change", { bubbles: true }));
    radios[1]![1]!.click();
    radios[1]![1]!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(radios[0]![1]!.checked).toBe(true);
  expect(radios[1]![1]!.checked).toBe(true);
  expect(changeA).toHaveBeenCalledWith("aa");
  expect(changeB).toHaveBeenCalledWith("bb");
  render(null, host); host.remove();
});
