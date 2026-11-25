// @vitest-environment happy-dom
import { render } from "preact";
import { expect, it, vi } from "vitest";
import { Disclosure } from "../system/components/Disclosure";

it("only the mounted disclosure retains a toggle handler after repeated replacements", () => {
  const host = document.createElement("div");
  const old: { node: HTMLDetailsElement; listener: ReturnType<typeof vi.fn> }[] = [];
  const toggle = (node: HTMLDetailsElement) => node.dispatchEvent(new Event("toggle"));
  try {
    for (let generation = 0; generation < 24; generation++) {
      const superseded = vi.fn();
      const current = vi.fn((_event: Event) => {});
      render(<Disclosure key={generation} onToggle={superseded}><summary>Work</summary></Disclosure>, host);
      const node = host.querySelector("details")!;
      render(<Disclosure key={generation} onToggle={current}><summary>Work</summary></Disclosure>, host);
      expect(host.querySelector("details")).toBe(node);
      toggle(node);
      expect(superseded).not.toHaveBeenCalled();
      expect(current).toHaveBeenCalledTimes(1);
      expect(current.mock.calls[0]?.[0].target).toBe(node);
      old.push({ node, listener: current });
    }
    render(null, host);
    for (const { node, listener } of old) {
      toggle(node);
      expect(listener).toHaveBeenCalledTimes(1);
    }
  } finally {
    render(null, host);
  }
});
