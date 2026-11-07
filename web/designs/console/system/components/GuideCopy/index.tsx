import { useState } from "preact/hooks";
import { Button } from "../Button";
import { Section } from "../Section";

export function GuideCopy({ title, line, note, copy, copied, failed }: { title: string; line: string; note: string; copy: string; copied: string; failed: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return <Section title={title} sub={note}><div class="work-row"><code>{line}</code><Button onClick={() => { if (!navigator.clipboard) { setState("failed"); return; } void navigator.clipboard.writeText(line).then(() => setState("copied"), () => setState("failed")); }}>{state === "copied" ? copied : copy}</Button>{state === "failed" ? <div role="alert">{failed}</div> : null}</div></Section>;
}
