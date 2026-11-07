export interface OutputLine { text: string; kind: "key" | "value" | "add" | "remove" | "hunk" | "file" | "plain" }
export interface RenderedOutput { kind: "json" | "diff"; lines: OutputLine[] }
export interface OutputInput { command: string; text: string; complete: boolean }
const MAX_OUTPUT = 64 * 1024;
type Renderer = (input: OutputInput) => RenderedOutput | undefined;

const json: Renderer = ({ command, text }) => {
  if (!/^\s*shellboy(?:\s|$)/.test(command)) return;
  try {
    const value: unknown = JSON.parse(text);
    const lines: OutputLine[] = [];
    const visit = (v: unknown, indent: string, prefix: string, depth: number): void => {
      if (depth > 32 || lines.length > 4096) throw new Error("too deep");
      if (v !== null && typeof v === "object") {
        const entries = Object.entries(v);
        if (entries.length === 0) { lines.push({ kind: "value", text: indent + prefix + (Array.isArray(v) ? "[]" : "{}") }); return; }
        if (prefix) lines.push({ kind: "key", text: indent + prefix.trimEnd() });
        for (const [key, child] of entries) visit(child, indent + (prefix ? "  " : ""), Array.isArray(v) ? "- " : `${JSON.stringify(key)}: `, depth + 1);
      } else lines.push({ kind: "value", text: indent + prefix + JSON.stringify(v) });
    };
    visit(value, "", "", 0);
    return { kind: "json", lines };
  } catch { return; }
};
const diff: Renderer = ({ command, text }) => {
  if (!/\bgit\s+(?:diff|show|log\s+-p)(?:\s|$)/.test(command) && !/^--- .+\n\+\+\+ /m.test(text) && !/^diff --git /m.test(text)) return;
  return { kind: "diff", lines: text.split("\n").map((line): OutputLine => ({ text: line, kind: line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ") ? "file" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "plain" })) };
};
export const outputRenderers: readonly Renderer[] = [diff, json];
export function renderOutput(input: OutputInput): RenderedOutput | undefined {
  if (!input.complete || input.text.length > MAX_OUTPUT) return;
  for (const renderer of outputRenderers) { const result = renderer(input); if (result) return result; }
  return undefined;
}
