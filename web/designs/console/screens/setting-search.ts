import { translator, type MessageKey } from "../../../ui-core/src";

type T = ReturnType<typeof translator>;
export function settingSearch(t: T, id: string, label: MessageKey, notes: readonly MessageKey[] = [], scope?: string) {
  return {
    id,
    label: scope ? `${scope} / ${t(label)}` : t(label),
    terms: [...(scope ? [scope] : []), ...(["en", "ja"] as const).flatMap((lang) => [label, ...notes].map((key) => translator(lang)(key)))],
  };
}
export type SettingSearch = ReturnType<typeof settingSearch>;

export type RegisterSetting = (id: string, key: MessageKey, notes?: readonly MessageKey[], scope?: string) => { settingId: string; label: string };
