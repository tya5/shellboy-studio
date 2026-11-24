import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Tooltip } from "../Tooltip";

export function CopyButton({ text, label, copiedLabel, failedLabel }: { text: string; label: string; copiedLabel: string; failedLabel: string }) {
  const [status, setStatus] = useState<"copied" | "failed">();
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => { attempt.current++; clearTimeout(timer.current); }, []);
  const copy = async () => {
    const id = ++attempt.current;
    clearTimeout(timer.current);
    setStatus(undefined);
    try {
      await navigator.clipboard.writeText(text);
      if (id !== attempt.current) return;
      setStatus("copied");
    } catch {
      if (id !== attempt.current) return;
      setStatus("failed");
    }
    timer.current = setTimeout(() => setStatus(undefined), 1500);
  };
  return <><Tooltip label={status === "copied" ? copiedLabel : label}>
    <Button variant="ghost" icon label={label} disabled={!text} data-copy-state={status} onClick={() => void copy()}>
      <Icon role={status === "copied" ? "output.copied" : "output.copy"} size="small" />
    </Button>
  </Tooltip><span class="copy-button-status" role="status" aria-live="polite" aria-atomic="true">{status === "copied" ? copiedLabel : status === "failed" ? failedLabel : ""}</span></>;
}
