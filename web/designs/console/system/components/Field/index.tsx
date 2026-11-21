import type { ComponentChildren, JSX } from "preact";

export function Field({ ariaLabel, leading, as = "input", options, onSelectChange, ...rest }: { ariaLabel: string; leading?: ComponentChildren; as?: "input" | "select"; options?: readonly { value: string; label: string }[]; onSelectChange?: (value: string) => void } & JSX.InputHTMLAttributes<HTMLInputElement>) {
  return <label class="form-field-root">{leading}{as === "select" ? <select aria-label={ariaLabel} {...(rest as unknown as JSX.SelectHTMLAttributes<HTMLSelectElement>)} onChange={(event) => onSelectChange?.(event.currentTarget.value)}>{options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input aria-label={ariaLabel} {...rest} />}</label>;
}
