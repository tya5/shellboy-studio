import type { ComponentChildren, JSX } from "preact";

export function Field({ ariaLabel, leading, ...rest }: { ariaLabel: string; leading?: ComponentChildren } & JSX.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label class="field">
      {leading}
      <input aria-label={ariaLabel} {...rest} />
    </label>
  );
}
