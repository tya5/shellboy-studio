import { type Sum, type Translate } from "../../../ui-core/src";

export function tokenTotal(t: Translate, sum: Sum, incomplete: boolean): string {
  if (sum.overflow) return t("common.inconsistent");
  if (sum.known === undefined) return t("analytics.noValue");
  const value = sum.known.toLocaleString("en-US");
  return incomplete || sum.unknown > 0 ? t("usage.minimum", { value }) : value;
}
