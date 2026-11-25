// @vitest-environment happy-dom
import "@preact/signals";
// @ts-expect-error Node reads verify the production container-query contract.
import { readFileSync } from "node:fs";
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { PanelTabs } from "../system/components/PanelTabs";

const items = [
  { id: "work", label: "動作", icon: "panel.work" as const },
  { id: "reply", label: "要返信", icon: "panel.reply_needed" as const },
  { id: "waiting", label: "返信待ち", icon: "panel.awaiting_reply" as const },
  { id: "info", label: "情報", icon: "panel.information" as const },
];

it("preserves tab names and phone picker without scrolling on layout changes", async () => {
  const host = document.createElement("div");
  const scroll = vi.fn();
  const spy = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(scroll);
  try {
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="work" onSelect={() => {}} />, host));
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="info" onSelect={() => {}} />, host));
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="info" rail onSelect={() => {}} />, host));
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="info" onSelect={() => {}} />, host));
    expect(host.querySelector(".panel-tabs-measure")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(items.length);
    const counted = items.map(item => ({ ...item, count: 2 }));
    await act(async () => render(<PanelTabs label="Panel" items={counted} selected="info" onSelect={() => {}} />, host));
    expect(host.querySelector("#panel-tab-info")?.getAttribute("aria-label")).toBe("情報 2");
    expect(scroll).not.toHaveBeenCalled();
    const select = host.querySelector<HTMLSelectElement>('select')!;
    expect(select).toBeTruthy();
    expect(host.querySelector(".form-field-label")?.textContent).toBe("Panel");
    expect(select.options[1]?.textContent).toBe("要返信 (2)");
    const onSelect = vi.fn(() => {});
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="work" onSelect={onSelect} />, host));
    const picker = host.querySelector<HTMLSelectElement>('select')!;
    picker.value = "reply";
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledWith("reply");
    expect(host.querySelector('[role="tablist"] [role="tab"]')).toBeTruthy();
  } finally { render(null, host); spy.mockRestore(); }
});

it.each([390, 1280])("mounts the section picker and preserves tab semantics at %ipx", async width => {
  const host = document.createElement("div");
  host.style.width = `${width}px`;
  await act(async () => render(<PanelTabs label="Right panel section" items={items} selected="work" onSelect={() => {}} />, host));
  expect(host.querySelector(".form-field-label")?.textContent).toBe("Right panel section");
  expect(host.querySelector("select")?.value).toBe("work");
  expect(host.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]')?.id).toBe("panel-tab-work");
  const css = readFileSync("designs/console/system/components/PanelTabs/style.css", "utf8");
  expect(css).toContain("@container app (max-width:899px)");
  expect(css).toContain(".panel-tabs-control > .panel-tabs:not(.panel-tabs-rail) { display:none; }");
  expect(css).toContain(".panel-tabs-phone-picker { display:block; }");
  expect(css).not.toContain(".panel-tabs-phone-picker { display:block; padding:");
  render(null, host);
});
