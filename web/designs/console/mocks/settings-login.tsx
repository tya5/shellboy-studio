import { render } from "preact";
import { useId, useState } from "preact/hooks";
import { translator } from "../../../ui-core/src/i18n";
import { Button } from "../system/components/Button";
import { Field } from "../system/components/Field";
import { PageHeader } from "../system/components/PageHeader";
import { Section } from "../system/components/Section";
import { SettingRow } from "../system/components/SettingRow";
import { SubView } from "../system/components/SubView";
import "../system/tokens/console.css";
import "../system/components.css";
import "../system/layout.css";
import "./settings-login.css";

const states = ["off", "on", "approval", "refused", "removed", "unknown", "unsupported"] as const;
type State = typeof states[number];
const labels = {
  en: { startup: "Startup", setting: "Open Studio at login", help: "Opens Studio when you sign in to this computer.", on: "On", off: "Off", state: "Example OS state",
    feedback: { off: "Not registered (default).", on: "Enabled by the OS.", approval: "Not enabled. Approve Shellboy Studio in your system's Login Items settings.", refused: "The OS refused the change. Startup is still off.", removed: "The startup item was turned off or removed in system settings.", unknown: "Couldn't verify startup status. Check your system settings.", unsupported: "Available only from a supported local Studio launcher." } },
  ja: { startup: "起動", setting: "ログイン時に Studio を開く", help: "このコンピュータにログインすると Studio を開きます。", on: "オン", off: "オフ", state: "OS の状態（見本）",
    feedback: { off: "未登録（既定）。", on: "OS で有効です。", approval: "無効です。システムの「ログイン項目」で Shellboy Studio を許可してください。", refused: "OS が変更を拒否しました。自動起動はオフのままです。", removed: "システム設定で自動起動が無効化されたか、項目が削除されました。", unknown: "自動起動の状態を確認できません。システム設定を確認してください。", unsupported: "対応するローカルの Studio ランチャーからのみ設定できます。" } },
};

function SettingsFrame({ phone, lang, state, onChange }: { phone?: boolean; lang: "en" | "ja"; state: State; onChange: (next: State) => void }) {
  const t = translator(lang), copy = labels[lang];
  const id = useId();
  const enabled = state === "on";
  const known = state !== "unknown" && state !== "unsupported";
  const feedback = <span id={`${id}-status`} role="status">{copy.feedback[state]}</span>;
  return <div class={`app login-settings-frame${phone ? " login-settings-phone" : ""}`} lang={lang}>
    <SubView title={t("set.title")} close={{ href: "#mock", label: t("common.close") }} groupedNav searchLabel={t("set.search")} items={[
      {key:"general", href:"#mock", role:"settings.general", label:t("set.section.general"), current:false, group:t("set.group.start")},
      {key:"connections", href:"#mock", role:"settings.connections", label:t("set.section.connections"), current:false, group:t("set.group.start")},
      {key:"appearance", href:"#mock", role:"settings.appearance", label:t("set.section.appearance"), current:false, group:t("set.group.display")},
      {key:"studio", href:"#mock", role:"settings.studio", label:t("set.section.studio"), current:true, group:t("set.group.app"), searchRows:[{id:`login-${id}`, label:copy.setting, terms:[copy.startup, copy.setting]}]},
    ]}>
      <PageHeader title={t("set.section.studio")} description={t("set.sub.studio")} />
      <Section title={copy.startup}>
        <SettingRow settingId={`login-${id}`} label={copy.setting} description={copy.help} feedback={feedback} control={known ?
          <Button class="login-switch" role="switch" aria-checked={enabled} aria-label={copy.setting} aria-describedby={`${id}-status`}
            disabled={state === "approval"} onClick={() => onChange(enabled ? "off" : "on")}>
            <span class="login-switch-track" aria-hidden="true"/><span aria-hidden="true">{enabled ? copy.on : copy.off}</span>
          </Button> : null} />
      </Section>
      <Section title={t("pair.title")} sub={t("pair.help")}><p>{t("pair.noHosts")}</p></Section>
    </SubView>
  </div>;
}

function Mock() {
  const [state, setState] = useState<State>("off");
  const [lang, setLang] = useState<"en" | "ja">("en");
  return <main class="login-mock">
    <h1>Studio Settings: Open Studio at login</h1>
    <p>Settings v8 extension. Two widths, one simulated OS state. No OS registration, first-run prompt, or owner connection.</p>
    <div class="login-fixture-controls">
      <Field as="select" label="Mock language" value={lang} options={[{value:"en", label:"English"}, {value:"ja", label:"日本語"}]} onSelectChange={value => setLang(value === "ja" ? "ja" : "en")} />
      <Field as="select" label={labels[lang].state} value={state} options={states.map(value => ({ value, label:labels[lang].feedback[value] }))} onSelectChange={value => setState(value as State)} />
    </div>
    <h2>Desktop</h2><SettingsFrame lang={lang} state={state} onChange={setState} />
    <h2>Phone</h2><SettingsFrame phone lang={lang} state={state} onChange={setState} />
    <p class="muted">Phone width demonstrates responsive layout only. Select the unsupported example to see what a remote browser would show.</p>
  </main>;
}
render(<Mock />, document.getElementById("mock")!);
