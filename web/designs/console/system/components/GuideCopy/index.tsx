import { CopyButton } from "../CopyButton";
import { Section } from "../Section";

export function GuideCopy({ title, line, note, copy, copied, failed, collapsed = false }: { title: string; line: string; note: string; copy: string; copied: string; failed: string; collapsed?: boolean }) {
  const content = <Section title={title} sub={note}><div class="work-row"><code>{line}</code><CopyButton text={line} label={copy} copiedLabel={copied} failedLabel={failed} /></div></Section>;
  return collapsed ? <details><summary>{title}</summary>{content}</details> : content;
}
