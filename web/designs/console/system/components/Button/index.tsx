import type { ComponentChildren, JSX } from "preact";

type Variant = "plain" | "primary" | "warn" | "stop" | "link";

export function Button({
  variant = "plain",
  icon,
  label,
  children,
  ...rest
}: {
  variant?: Variant;
  /** Icon only: `label` becomes the accessible name. */
  icon?: boolean;
  label?: string;
  children: ComponentChildren;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "label">) {
  const cls = ["btn", variant !== "plain" ? variant : "", icon ? "icon" : ""].filter(Boolean).join(" ");
  return (
    <button type="button" class={cls} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
