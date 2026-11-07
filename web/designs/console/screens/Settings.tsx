import { useEffect, useRef } from "preact/hooks";
import { LANGS, type DesignContext } from "../../../ui-core/src";
import { Button } from "../system/components";

/** Closes on Escape or a press outside it; the button that opened it toggles it itself. */
export function Settings({ context, onClose }: { context: DesignContext; onClose: () => void }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const press = (e: Event) => {
      const target = e.target as Element | null;
      if (root.current?.contains(target) || target?.closest("[data-settings-toggle]")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      document.querySelector<HTMLElement>("[data-settings-toggle]")?.focus();
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const { model, prefs, designs, setPrefs } = context;
  const t = model.t.value;
  const current = designs.find((d) => d.name === prefs.value.design);
  const invalid = model.data.invalidFrames.value;
  const version = model.data.bridgeVersion.value;
  return (
    <aside ref={root} class="panel" aria-label={t("settings.title")}>
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
