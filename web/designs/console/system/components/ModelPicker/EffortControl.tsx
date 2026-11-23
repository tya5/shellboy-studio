import { useEffect, useState } from "preact/hooks";
import { Button, ButtonGroup, Field } from "..";

const PRESETS = ["", "low", "medium", "high"] as const;

/** One effort control shared by Conversation and Settings; unknown values remain free text. */
export function EffortControl({ value, label, labels, disabled, reset, onSelect, onInput, onCommit, explicitCommit = false }: {
  value: string; label: string; labels: { default: string; low: string; medium: string; high: string; other: string };
  disabled?: boolean; explicitCommit?: boolean; reset?: object; onSelect: (value: string) => void; onInput?: (value: string) => void; onCommit?: (value: string) => void;
}) {
  const customValue = !PRESETS.includes(value as typeof PRESETS[number]);
  const [custom, setCustom] = useState(customValue ? value : "");
  const [otherMode, setOtherMode] = useState(customValue);
  useEffect(() => { if (customValue) { setCustom(value); setOtherMode(true); } else { setCustom(""); setOtherMode(false); } }, [value, reset]);
  const otherSelected = otherMode || customValue;
  const labelsByValue = [labels.default, labels.low, labels.medium, labels.high];
  return <div class="stack"><ButtonGroup label={label}>{PRESETS.map((preset, index) => <Button key={preset || "default"} disabled={disabled} aria-pressed={value === preset && !otherSelected} onClick={() => { setCustom(""); setOtherMode(false); onSelect(preset); }}>{labelsByValue[index]}</Button>)}<Button disabled={disabled} aria-pressed={otherSelected} onClick={() => { if (customValue) return; setOtherMode(true); }}>{labels.other}</Button></ButtonGroup><Field ariaLabel={labels.other} placeholder={labels.other} value={custom} disabled={disabled} onInput={(event) => { setCustom(event.currentTarget.value); onInput?.(event.currentTarget.value); }} onKeyDown={(event) => { if (event.key === "Enter" && custom) onCommit?.(custom); }} onBlur={() => { if (!explicitCommit && custom) onCommit?.(custom); }} /></div>;
}
