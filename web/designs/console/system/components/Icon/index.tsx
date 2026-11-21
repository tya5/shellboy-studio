import type { IconRole } from "../../icons/roles";
import { glyphForRole } from "../../icons/theme";

export type { IconRole } from "../../icons/roles";

export type IconSize = "default" | "small" | "menu";

export function Icon({ role, size = "default" }: { role: IconRole; size?: IconSize }) {
  const sizeClass = size === "default" ? "" : ` ${size}`;
  return <svg class={`i${sizeClass}`} viewBox="0 0 24 24" aria-hidden="true">{glyphForRole(role)}</svg>;
}
