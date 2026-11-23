import type { ComponentChildren, JSX } from "preact";
import { useId } from "preact/hooks";

/**
 * A single-line input or a native select. Without `label` the control is named by `ariaLabel`. With a visible
 * `label` it stacks the name above the control and optional `help` or `error` text below it, tied by `for`
 * and `aria-describedby`.
 */
export function Field({ ariaLabel, label, help, error, leading, as = "input", options, onSelectChange, id, ...rest }: { ariaLabel?: string; label?: string; help?: ComponentChildren; error?: ComponentChildren; leading?: ComponentChildren; as?: "input" | "select"; options?: readonly { value: string; label: string }[]; onSelectChange?: (value: string) => void } & JSX.InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const stacked = label !== undefined || help !== undefined || error !== undefined;
  const controlId = typeof id === "string" ? id : stacked ? generated : undefined;
  const helpId = help !== undefined ? `${controlId}-help` : undefined;
  const errorId = error !== undefined ? `${controlId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const named = { id: controlId, "aria-label": label === undefined ? ariaLabel : undefined, "aria-describedby": describedBy };
  const invalid = error !== undefined ? { "aria-invalid": "true" as const } : {};
  const control = <label class="form-field-root">{leading}{as === "select" ? <select {...named} {...invalid} {...(rest as unknown as JSX.SelectHTMLAttributes<HTMLSelectElement>)} onChange={(event) => onSelectChange?.(event.currentTarget.value)}>{options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input {...named} {...invalid} {...rest} />}</label>;
  if (!stacked) return control;
  return (
    <div class="form-field-stack">
      {label !== undefined ? <label class="form-field-label" for={controlId}>{label}</label> : null}
      {control}
      {help !== undefined ? <p class="form-field-help" id={helpId}>{help}</p> : null}
      {error !== undefined ? <p class="form-field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}
