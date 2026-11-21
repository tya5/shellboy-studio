import type { IconRole } from "../../icons/roles";
import { glyphForRole } from "../../icons/theme";

export type { IconRole } from "../../icons/roles";

export function Icon({ role, small }: { role: IconRole; small?: boolean }) {
  return <svg class={small ? "i s" : "i"} viewBox="0 0 24 24" aria-hidden="true">{glyphForRole(role)}</svg>;
}
