import { useEffect, useRef } from "preact/hooks";
import { formatRoute, type DesignContext } from "../../../ui-core/src";
import { AppearanceChoices } from "./Appearance";

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
  const { model } = context;
  const t = model.t.value;
  const invalid = model.data.invalidFrames.value;
  const version = model.data.bridgeVersion.value;
  return (
    <aside ref={root} class="panel" aria-label={t("settings.title")}>
      <AppearanceChoices context={context} />
      <a class="btn link" href={formatRoute({ view: "settings", section: "appearance" })} onClick={onClose}>
        {t("settings.all")}
      </a>
      {version ? <div class="muted caption">{t("settings.version", { version })}</div> : null}
      {invalid.count > 0 ? <div class="muted caption">{t("settings.problems", { n: invalid.count, last: invalid.last ?? "" })}</div> : null}
    </aside>
  );
}
