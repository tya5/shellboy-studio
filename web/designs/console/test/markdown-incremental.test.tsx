// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Markdown, splitStableMarkdown } from "../system/components/Message";
import { createRenderer } from "../system/components/Message/markdown";

const props = { copyLabel: "Copy", copiedLabel: "Copied" };
const normalize = (node: Node): unknown => node.nodeType === Node.TEXT_NODE ? node.textContent : node instanceof Element ? [node.tagName, [...node.attributes].map(a => [a.name, a.value]).sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")), [...node.childNodes].map(normalize)] : null;

it("mounts Markdown and parses each stable live block once", async () => {
  const host = document.createElement("div");
  const parsed: string[] = [];
  const base = createRenderer("Copy");
  const renderer = (_copy: string) => (text: string) => { parsed.push(text); return base(text); };
  try {
    await act(async () => render(<Markdown {...props} text={"First paragraph\n\nSecond"} live renderer={renderer} />, host));
    expect(parsed).toEqual(["First paragraph", "Second"]);
    await act(async () => render(<Markdown {...props} text={"First paragraph\n\nSecond grows"} live renderer={renderer} />, host));
    expect(parsed).toEqual(["First paragraph", "Second", "Second grows"]);
    await act(async () => render(<Markdown {...props} text={"First paragraph\n\nSecond grows\n\nThird"} live renderer={renderer} />, host));
    expect(parsed).toEqual(["First paragraph", "Second", "Second grows", "Second grows", "Third"]);
    expect(parsed.filter(text => text === "First paragraph")).toHaveLength(1);
  } finally { render(null, host); }
});

it.each([
  ["continuation paragraph", "first paragraph\n\n    continuation\n    line"],
  ["reference definition", "[guide]: https://example.test\n\n[guide]"],
  ["loose list", "- first\n\n  second paragraph\n\n- next"],
])("keeps saved %s Markdown byte-for-byte equivalent to the normal renderer", async (_name, text) => {
  const host = document.createElement("div");
  const expected = document.createElement("div");
  expected.innerHTML = createRenderer("Copy")(text);
  await act(async () => render(<Markdown {...props} text={text} renderer={() => createRenderer("Copy")} />, host));
  const prose = host.querySelector(".message-markdown")!.cloneNode(true) as HTMLElement;
  prose.querySelectorAll(".message-code-copy").forEach(node => node.remove());
  expect(normalize(prose)).toEqual(["DIV", [["class", "message-markdown"], ["data-reading-body", ""]], [...expected.childNodes].map(normalize)]);
  render(null, host);
});

it("does not commit an uncertain paragraph, list, or reference block while streaming", () => {
  expect(splitStableMarkdown("paragraph\n\n    continuation").stable).toEqual([]);
  expect(splitStableMarkdown("[guide]: https://example.test\n\nUse [guide]").stable).toEqual([]);
  expect(splitStableMarkdown("- one\n\n- two\n\nplain tail").stable).toEqual([]);
  expect(splitStableMarkdown("plain one\n\nplain two\n\nopen").stable).toEqual(["plain one", "plain two"]);
});


it("copies escaped Markdown code verbatim through the shared labelled icon", async () => {
  const host = document.createElement("div");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const expected = `<b> & echo
`;
  try {
    await act(async () => render(<Markdown {...props} text={"```sh\n" + expected + "```"} renderer={createRenderer} />, host));
    const button = host.querySelector<HTMLButtonElement>('.message-code button[aria-label="Copy"]')!;
    expect(button.querySelector("svg")).not.toBeNull();
    await act(async () => button.click());
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(host.querySelector('.message-code [role="status"]')?.textContent).toBe("Copied");
    expect(host.querySelector(".message-code b")).toBeNull();
  } finally { render(null, host); vi.unstubAllGlobals(); }
});
