import { useState } from "preact/hooks";
import { Button } from "../Button";
import { Section } from "../Section";

export function GuideCopy({ title, line, note, copy, copied, failed, collapsed = false }: { title: string; line: string; note: string; copy: string; copied: string; failed: string; collapsed?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const content = <Section title={title} sub={note}><div class="work-row"><code>{line}</code><Button onClick={() => { if (!navigator.clipboard) { setState("failed"); return; } void navigator.clipboard.writeText(line).then(() => setState("copied"), () => setState("failed")); }}>{state === "copied" ? copied : copy}</Button>{state === "failed" ? <div role="alert">{failed}</div> : null}</div></Section>;
  return collapsed ? <details><summary>{title}</summary>{content}</details> : content;
}
