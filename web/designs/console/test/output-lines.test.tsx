// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { render } from "preact";
import { OutputLines, outputLineRange } from "../screens/Conversation";

it("mounts only the viewport-sized window plus overscan for long formatted output", () => {
  const lines = Array.from({ length: 5000 }, (_, index) => ({ text: `line-${index}`, kind: "plain" as const }));
  const host = document.createElement("div");
  render(<OutputLines lines={lines} boxed={false} />, host);
  expect(host.querySelectorAll("span").length).toBeLessThan(lines.length);
  expect(host.querySelector("pre")?.textContent).toContain("line-0");
});

it("bounds measured visible output line ranges", () => {
  expect(outputLineRange(1000, 900, 200)).toEqual({ first: 900, last: 1000 });
  expect(outputLineRange(1000, -20, 40)).toEqual({ first: 0, last: 40 });
});
