import { settingSearch } from "./setting-search";
import { LANGS, type DesignContext } from "../../../ui-core/src";
import { Button, ButtonGroup } from "../system/components";

const APPEARANCE = {
  theme: { id: "appearance.theme", label: "settings.appearance" },
  design: { id: "appearance.design", label: "settings.design" },
  language: { id: "appearance.language", label: "settings.language" },
} as const;

export function appearanceSearchRows(context: DesignContext) {
  const t = context.model.t.value;
  return [APPEARANCE.theme, ...(context.designs.length > 1 ? [APPEARANCE.design] : []), APPEARANCE.language].map(({ id, label }) => settingSearch(t, id, label));
}

/** Theme, design and language: per-browser choices, shown in the popover and in Settings. */
export function AppearanceChoices({ context, showLanguage = true, searchable }: { context: DesignContext; showLanguage?: boolean; searchable?: boolean }) {
  const { model, prefs, designs, setPrefs } = context;
  const t = model.t.value;
  const current = designs.find((d) => d.name === prefs.value.design);
  return (
    <>
      <h3 data-setting-id={searchable ? APPEARANCE.theme.id : undefined}>{t(APPEARANCE.theme.label)}</h3>
      <ButtonGroup label={t(APPEARANCE.theme.label)}>
        {current?.themes.map((theme) => (
          <Button key={theme.name} aria-pressed={prefs.value.theme === theme.name} onClick={() => setPrefs({ theme: theme.name })}>
            {theme.name === "auto" ? t("settings.themeAuto") : theme.title}
          </Button>
        ))}
      </ButtonGroup>
      {designs.length > 1 ? (
        <>
          <h3 data-setting-id={searchable ? APPEARANCE.design.id : undefined}>{t(APPEARANCE.design.label)}</h3>
          <ButtonGroup label={t(APPEARANCE.design.label)}>
            {designs.map((d) => (
              <Button key={d.name} aria-pressed={prefs.value.design === d.name} onClick={() => setPrefs({ design: d.name, theme: d.themes[0]!.name })}>
                {d.title}
              </Button>
            ))}
          </ButtonGroup>
        </>
      ) : null}
      {showLanguage ? <><h3 data-setting-id={searchable ? APPEARANCE.language.id : undefined}>{t(APPEARANCE.language.label)}</h3>
      <ButtonGroup label={t(APPEARANCE.language.label)}>
        {LANGS.map((lang) => (
          <Button key={lang} aria-pressed={prefs.value.lang === lang} onClick={() => setPrefs({ lang })}>
            {t(`lang.${lang}`)}
          </Button>
        ))}
      </ButtonGroup></> : null}
    </>
  );
}
