// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Markdown, splitStableMarkdown } from "../system/components/Message";
import { createRenderer } from "../system/components/Message/markdown";

const props = { copyLabel: "Copy", copiedLabel: "Copied" };
const normalize = (node: Node): unknown => node.nodeType === Node.TEXT_NODE ? node.textContent : node instanceof Element ? [node.tagName, [...node.attributes].map(a => [a.name, a.value]).sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? "")), [...node.childNodes].map(normalize)] : null;

it("mounts Markdown with a counting renderer and reparses only a live tail", async () => {
  const host = document.createElement("div");
  let parsed = 0;
  const base = createRenderer("Copy");
  const renderer = (_copy: string) => (text: string) => { parsed++; return base(text); };
  try {
    await act(async () => render(<Markdown {...props} text="First paragraph\n\nSecond" live renderer={renderer} />, host));
    expect(parsed).toBe(1);
    await act(async () => render(<Markdown {...props} text="First paragraph\n\nSecond grows" live renderer={renderer} />, host));
    expect(parsed).toBe(2);
    await act(async () => render(<Markdown {...props} text="First paragraph\n\nSecond grows\n\nThird" live renderer={renderer} />, host));
    expect(parsed).toBe(3);
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
  expect(normalize(host.querySelector(".message-markdown")!)).toEqual(["DIV", [["class", "message-markdown"], ["data-reading-body", ""]], [...expected.childNodes].map(normalize)]);
  render(null, host);
});

it("does not commit an uncertain paragraph, list, or reference block while streaming", () => {
  expect(splitStableMarkdown("paragraph\n\n    continuation").stable).toEqual([]);
  expect(splitStableMarkdown("[guide]: https://example.test\n\nUse [guide]").stable).toEqual([]);
  expect(splitStableMarkdown("- one\n\n- two\n\nplain tail").stable).toEqual([]);
  expect(splitStableMarkdown("plain one\n\nplain two\n\nopen").stable).toEqual(["plain one", "plain two"]);
});
