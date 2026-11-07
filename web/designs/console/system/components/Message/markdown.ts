// Markdown to HTML. `html: false` means model text can't inject markup, so no sanitizer is
// needed; links are limited to http, https and mailto. Loaded on demand; until then the text
// is shown as it is.
import MarkdownIt from "markdown-it";

const SAFE_LINK = /^(https?:|mailto:)/i;

export function createRenderer(copyLabel: string): (text: string) => string {
  const md = new MarkdownIt({ html: false, linkify: false, breaks: false });
  md.validateLink = (url) => SAFE_LINK.test(url.trim());
  const escape = md.utils.escapeHtml;
  md.renderer.rules.fence = (tokens, i) =>
    `<div class="code"><button type="button" class="btn" data-copy>${escape(copyLabel)}</button><pre><code>${escape(tokens[i]!.content)}</code></pre></div>`;
  md.renderer.rules.code_block = md.renderer.rules.fence;
  md.renderer.rules.link_open = (tokens, i, options, _env, self) => {
    tokens[i]!.attrSet("target", "_blank");
    tokens[i]!.attrSet("rel", "noopener noreferrer");
    return self.renderToken(tokens, i, options);
  };
  return (text) => md.render(text);
}
