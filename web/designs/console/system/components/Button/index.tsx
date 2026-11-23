import type { ComponentChildren, JSX, Ref } from "preact";

type Variant = "outline" | "primary" | "ghost" | "link" | "warn" | "stop";

export function Button({
  variant = "outline",
  icon,
  label,
  children,
  buttonRef,
  class: customClass,
  ...rest
}: {
  variant?: Variant;
  /** Icon only: `label` becomes the accessible name. */
  icon?: boolean;
  label?: string;
  children: ComponentChildren;
  buttonRef?: Ref<HTMLButtonElement>;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "label">) {
  const cls = ["btn", variant !== "outline" ? `btn-${variant}` : "", icon ? "btn-icon" : "", customClass].filter(Boolean).join(" ");
  return (
    <button ref={buttonRef} type="button" class={cls} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
