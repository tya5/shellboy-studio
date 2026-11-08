// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { Chart } from "../system/components/Chart";

it("measures every axis label and remeasures when its text changes", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const proto = Object.getPrototypeOf(document.createElementNS("http://www.w3.org/2000/svg", "text"));
  const old = Object.getOwnPropertyDescriptor(proto, "getComputedTextLength");
  Object.defineProperty(proto, "getComputedTextLength", { configurable: true, value: function (this: SVGElement) { return (this.textContent?.length ?? 0) * 12; } });
  const draw = (label: string) => <Chart kind="columns" title="Test" source="fixture" series={[{ id: "n", label: "N", tone: "neutral" }]} points={[{ key: "day", label: "day", values: { n: 1000 } }]} format={(v) => v ? label : "0"} ariaSummary="Test" tableLabel="Table" categoryLabel="Day" noData="None" />;
  try {
    await act(async () => { render(draw("1.2M"), host); await new Promise((r) => setTimeout(r, 50)); });
    expect(host.querySelector(".axis")?.getAttribute("x1")).toBe("58");
    await act(async () => { render(draw("1234567890"), host); await new Promise((r) => setTimeout(r, 50)); });
    expect(host.querySelector(".axis")?.getAttribute("x1")).toBe("130");
    expect(host.querySelectorAll(".chart-y-tick")).toHaveLength(3);
  } finally {
    render(null, host);
    host.remove();
    if (old) Object.defineProperty(proto, "getComputedTextLength", old);
    else Reflect.deleteProperty(proto, "getComputedTextLength");
    vi.restoreAllMocks();
  }
});
