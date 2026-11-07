import { describe, expect, it } from "vitest";
import { renderOutput } from "../src/output-renderers";
describe("bounded output renderers", () => {
  it("renders shellboy JSON without changing strings", () => {
    const result = renderOutput({ command: "shellboy history", text: '{"message":"a\\nb"}', complete: true });
    expect(result?.kind).toBe("json");
    expect(result?.lines.map((l) => l.text).join("\n")).toContain('"a\\nb"');
    expect(renderOutput({ command: "shellboy", text: "{", complete: true })).toBeUndefined();
  });
  it("classifies diff hunks and preserves raw fallback", () => {
    const text = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new';
    expect(renderOutput({ command: "cat patch", text, complete: true })?.lines.map((l) => l.kind)).toEqual(["file", "file", "hunk", "remove", "add"]);
    expect(renderOutput({ command: "git diff", text, complete: false })).toBeUndefined();
    expect(renderOutput({ command: "git diff", text: "x".repeat(65537), complete: true })).toBeUndefined();
  });
});
