import { describe, expect, it } from "vitest";
import { createRenderer } from "../system/components/Message/markdown";

const render = createRenderer("Copy");

describe("Markdown", () => {
  it("renders the common cases", () => {
    expect(render("**b** `c`")).toContain("<strong>b</strong>");
    expect(render("**b** `c`")).toContain("<code>c</code>");
    expect(render("| a |\n|---|\n| b |")).toContain("<table>");
  });
  it("model text can't inject markup", () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
  it("only web and mail links become links, and they open safely", () => {
    expect(render("[x](javascript:alert(1))")).not.toContain("href");
    expect(render("[x](data:text/html,hi)")).not.toContain("href");
    const ok = render("[x](https://example.com)");
    expect(ok).toContain('href="https://example.com"');
    expect(ok).toContain('rel="noopener noreferrer"');
  });
  it("code blocks escape their text and carry a copy button", () => {
    const html = render("```sh\necho '<b>'\n```");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("data-copy");
  });
});
