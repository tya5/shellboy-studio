import { Icon, type IconRole } from "../Icon";
import { Tooltip } from "../Tooltip";
import type { ComponentChildren, JSX, Ref } from "preact";

type Variant = "outline" | "primary" | "ghost" | "warn" | "stop";

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

export function IconButton({ glyph, label, tooltip = label, ...props }: Omit<Parameters<typeof Button>[0], "children" | "icon" | "label"> & { glyph: IconRole; label: string; tooltip?: string }) {
  return <Tooltip label={tooltip}><Button variant="ghost" {...props} icon label={label}><Icon role={glyph} size="small" /></Button></Tooltip>;
}
