// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { MarkdownBlock } from "../system/components/Message";
import { splitStableMarkdown } from "../system/components/Message";

it("keeps completed markdown blocks stable while only the open tail grows", () => {
  const first = splitStableMarkdown("first paragraph\n\nsecond");
  const next = splitStableMarkdown("first paragraph\n\nsecond paragraph\n\nthird");
  expect(first.stable).toEqual(["first paragraph"]);
  expect(next.stable.slice(0, first.stable.length)).toEqual(first.stable);
  expect(next.stable).toEqual(["first paragraph", "second paragraph"]);
  expect(next.tail).toBe("third");
});

it("does not split blank lines inside a fenced code block", () => {
  const parsed = splitStableMarkdown("intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\ntrailing");
  expect(parsed.stable).toEqual(["intro", "```ts\nconst a = 1;\n\nconst b = 2;\n```"]);
  expect(parsed.tail).toBe("trailing");
});

it("parses only changed Markdown blocks when the answer grows", async () => {
  const host = document.createElement("div");
  let parsed = 0;
  const create = () => (text: string) => { parsed++; return `<p>${text}</p>`; };
  const draw = (tail: string, addNext = false) => render(<div>
    <MarkdownBlock key="stable" text="stable" copyLabel="Copy" copiedLabel="Copied" create={create} />
    <MarkdownBlock key={addNext ? "next" : "tail"} text={addNext ? "next tail" : tail} copyLabel="Copy" copiedLabel="Copied" create={create} />
  </div>, host);
  try {
    await act(async () => draw("tail"));
    expect(parsed).toBe(2);
    await act(async () => draw("tail grows"));
    expect(parsed).toBe(3);
    await act(async () => draw("tail grows", true));
    expect(parsed).toBe(4);
  } finally { render(null, host); }
});
