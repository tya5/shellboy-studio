// @vitest-environment happy-dom
import "@preact/signals";
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

it("minimally reveals each selected horizontal tab; the icon rail does not scroll", async () => {
  const host = document.createElement("div");
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  try {
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="work" onSelect={() => {}} />, host));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    scroll.mockClear();
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="info" onSelect={() => {}} />, host));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    scroll.mockClear();
    await act(async () => render(<PanelTabs label="Panel" items={items} selected="info" rail onSelect={() => {}} />, host));
    expect(scroll).not.toHaveBeenCalled();
  } finally { render(null, host); delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; }
});
