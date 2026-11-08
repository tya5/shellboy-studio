import { LANGS, type DesignContext } from "../../../ui-core/src";
import { Button, ButtonGroup } from "../system/components";

/** Theme, design and language: per-browser choices, shown in the popover and in Settings. */
export function AppearanceChoices({ context, showLanguage = true }: { context: DesignContext; showLanguage?: boolean }) {
  const { model, prefs, designs, setPrefs } = context;
  const t = model.t.value;
  const current = designs.find((d) => d.name === prefs.value.design);
  return (
    <>
      <h3>{t("settings.appearance")}</h3>
      <ButtonGroup label={t("settings.appearance")}>
        {current?.themes.map((theme) => (
          <Button key={theme.name} aria-pressed={prefs.value.theme === theme.name} onClick={() => setPrefs({ theme: theme.name })}>
            {theme.title}
          </Button>
        ))}
      </ButtonGroup>
      {designs.length > 1 ? (
        <>
          <h3>{t("settings.design")}</h3>
          <ButtonGroup label={t("settings.design")}>
            {designs.map((d) => (
              <Button key={d.name} aria-pressed={prefs.value.design === d.name} onClick={() => setPrefs({ design: d.name, theme: d.themes[0]!.name })}>
                {d.title}
              </Button>
            ))}
          </ButtonGroup>
        </>
      ) : null}
      {showLanguage ? <><h3>{t("settings.language")}</h3>
      <ButtonGroup label={t("settings.language")}>
        {LANGS.map((lang) => (
          <Button key={lang} aria-pressed={prefs.value.lang === lang} onClick={() => setPrefs({ lang })}>
            {t(`lang.${lang}`)}
          </Button>
        ))}
      </ButtonGroup></> : null}
    </>
  );
}
