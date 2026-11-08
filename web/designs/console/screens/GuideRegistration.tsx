import type { DesignContext } from "../../../ui-core/src";
import { Button, GuideCopy, Notice, Section } from "../system/components";

export function GuideRegistrationView({ context, collapsed = false }: { context: DesignContext; collapsed?: boolean }) {
  const { model, prefs, setPrefs } = context; const t = model.t.value;
  const state = model.guideRegistration.state.value;
  return <>
    {state.supported ? <Section title={t("guide.registration")}>
      <Button aria-pressed={!prefs.value.guideOptOut} disabled={state.busy} onClick={() => setPrefs({ guideOptOut: !prefs.value.guideOptOut })}>{t(prefs.value.guideOptOut ? "guide.enable" : "guide.disable")}</Button>
      <p class="muted caption">{t(state.registered ? "guide.registered" : "guide.notRegistered")}</p>
      {state.applied && !state.restart ? <p class="muted caption">{t("guide.live")}</p> : state.restart ? <p class="muted caption">{t("guide.restart")}</p> : null}
      {state.error ? <Notice tone="bad">{t("common.readError", { message: state.error })}</Notice> : null}
    </Section> : null}
    {state.registered ? <p class="muted caption">{t("guide.copyUnneeded")}</p> : <GuideCopy collapsed={collapsed} title={t("guide.title")} line={t("guide.line")} note={t("guide.note")} copy={t("code.copy")} copied={t("code.copied")} failed={t("guide.copyFailed")} />}
  </>;
}
