import type { ComponentChildren, JSX, Ref } from "preact";

type Variant = "plain" | "primary" | "warn" | "stop" | "link" | "quiet";

export function Button({
  variant = "plain",
  icon,
  label,
  children,
  buttonRef,
  ...rest
}: {
  variant?: Variant;
  /** Icon only: `label` becomes the accessible name. */
  icon?: boolean;
  label?: string;
  children: ComponentChildren;
  buttonRef?: Ref<HTMLButtonElement>;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "icon" | "label">) {
  const cls = ["btn", variant !== "plain" ? variant : "", icon ? "icon" : ""].filter(Boolean).join(" ");
  return (
    <button ref={buttonRef} type="button" class={cls} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
