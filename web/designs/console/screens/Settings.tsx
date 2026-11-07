import { LANGS, type DesignContext } from "../../../ui-core/src";
import { Button } from "../system/components";

export function Settings({ context }: { context: DesignContext }) {
  const { model, prefs, designs, setPrefs } = context;
  const t = model.t.value;
  const current = designs.find((d) => d.name === prefs.value.design);
  const invalid = model.data.invalidFrames.value;
  const version = model.data.bridgeVersion.value;
  return (
    <aside class="panel" aria-label={t("settings.title")}>
      <h3>{t("settings.appearance")}</h3>
      <div class="opts">
        {current?.themes.map((theme) => (
          <Button key={theme.name} aria-pressed={prefs.value.theme === theme.name} onClick={() => setPrefs({ theme: theme.name })}>
            {theme.title}
          </Button>
        ))}
      </div>
      {designs.length > 1 ? (
        <>
          <h3>{t("settings.design")}</h3>
          <div class="opts">
            {designs.map((d) => (
              <Button key={d.name} aria-pressed={prefs.value.design === d.name} onClick={() => setPrefs({ design: d.name, theme: d.themes[0]!.name })}>
                {d.title}
              </Button>
            ))}
          </div>
        </>
      ) : null}
      <h3>{t("settings.language")}</h3>
      <div class="opts">
        {LANGS.map((lang) => (
          <Button key={lang} aria-pressed={prefs.value.lang === lang} onClick={() => setPrefs({ lang })}>
            {t(`lang.${lang}`)}
          </Button>
        ))}
      </div>
      {version ? <div class="muted caption">{t("settings.version", { version })}</div> : null}
      {invalid.count > 0 ? <div class="muted caption">{t("settings.problems", { n: invalid.count, last: invalid.last ?? "" })}</div> : null}
    </aside>
  );
}
