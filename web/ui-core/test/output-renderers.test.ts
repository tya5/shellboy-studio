import { describe, expect, it } from "vitest";
import { outputExcerpt, renderOutput } from "../src/output-renderers";
describe("bounded output renderers", () => {
  it("renders shellboy JSON without changing strings", () => {
    const result = renderOutput({ command: "shellboy history", text: '{"message":"a\\nb"}', complete: true });
    expect(result?.kind).toBe("json");
    expect(result?.lines.map((l) => l.text).join("\n")).toContain('"a\\nb"');
    expect(renderOutput({ command: "shellboy", text: "{", complete: true })).toBeUndefined();
  });
  it("keeps the beginning and a bounded recent tail for very long output", () => {
    const text = `VISIBLE-HEAD\n${"x".repeat(100_000)}\nVISIBLE-TAIL`;
    const excerpt = outputExcerpt(text);
    expect(excerpt.length).toBeLessThanOrEqual(64 * 1024);
    expect(excerpt.startsWith("VISIBLE-HEAD")).toBe(true);
    expect(excerpt).toContain("characters omitted");
    expect(excerpt.endsWith("VISIBLE-TAIL")).toBe(true);
  });
  it("classifies diff hunks and preserves raw fallback", () => {
    const text = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new';
    expect(renderOutput({ command: "cat patch", text, complete: true })?.lines.map((l) => l.kind)).toEqual(["file", "file", "hunk", "remove", "add"]);
    expect(renderOutput({ command: "git diff", text, complete: true })?.lines[4]?.text).toContain("1 +new");
    expect(renderOutput({ command: "git diff", text, complete: false })).toBeUndefined();
    expect(renderOutput({ command: "git diff", text: "x".repeat(65537), complete: true })).toBeUndefined();
  });
});
