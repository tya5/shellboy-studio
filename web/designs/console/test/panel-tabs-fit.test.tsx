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

it.each(["dock", "sheet"] as const)("preserves full names and tab semantics in the %s", async placement => {
  const host = document.createElement("div");
  const onSelect = vi.fn();
  await act(async () => render(<PanelTabs placement={placement} label="Panel" items={items.map(item => ({...item, count: 2}))} selected="work" onSelect={onSelect} />, host));
  expect(host.querySelector(".panel-tabs-measure")?.getAttribute("aria-hidden")).toBe("true");
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(items.length);
  expect(host.querySelector("#panel-tab-info")?.getAttribute("aria-label")).toBe("情報 2");
  host.querySelector<HTMLButtonElement>("#panel-tab-reply")!.click();
  expect(onSelect).toHaveBeenCalledWith("reply");
  const css = readFileSync("designs/console/system/components/PanelTabs/style.css", "utf8");
  expect(css).toContain('[data-labels="icons"] .panel-tab-label { display:none; }');
  render(null, host);
});
