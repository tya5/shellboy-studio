import { useState } from "preact/hooks";
import { CAPABILITY_CONNECTION_SETUP, DIALECTS, formatRoute, OLLAMA_CONTEXT_URL, SERVICES, type DesignContext, type MessageKey, type TestState } from "../../../ui-core/src";
import { Button, ButtonGroup, ChoiceList, Field, KeyValue, Notice, Section } from "../system/components";
import { Rich } from "./Rich";

/** Longest model list drawn at once; the filter narrows the rest. */
const MODELS_SHOWN = 50;

type T = DesignContext["model"]["t"]["value"];

function External({ href, children }: { href: string; children: string }) {
  return (
    <a class="btn link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function Unavailable({ t }: { t: T }) {
  return (
    <Section title={t("setup.unavailable.title")} sub={t("setup.unavailable.body")}>
      <ol class="setup-steps">
        {(["setup.manual.1", "setup.manual.2", "setup.manual.3"] as const).map((k) => (
          <li key={k}>
            <Rich text={t(k)} />
          </li>
        ))}
      </ol>
    </Section>
  );
}

function TestResult({ t, state }: { t: T; state: TestState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "testing") return <Notice>{t("setup.test.running")}</Notice>;
  if (state.kind === "error") return <Notice tone="bad">{t("setup.test.error", { message: state.message })}</Notice>;
  const status = (n: number | undefined) => (n === undefined ? t("setup.status.none") : t("setup.status", { n }));
  if (state.kind === "ok") return <Notice>{t("setup.test.ok", { n: state.facts.models.length, status: status(state.facts.httpStatus) })}</Notice>;
  return (
    <Notice tone="bad">
      <Rich text={t(`setup.test.fail.${state.failure}` as MessageKey, { status: status(state.status) })} />
      {state.message ? <div class="muted caption">{t("setup.test.ownerWords", { message: state.message })}</div> : null}
    </Notice>
  );
}

export function Setup({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const s = model.setup;
  const [filter, setFilter] = useState("");
  const probe = s.probe.value;
  const service = s.service.value;
  const env = s.env.value;
  const test = s.test.value;
  const save = s.saveState.value;
  const lang = model.lang.value;
  const available = model.data.capabilities.value.includes(CAPABILITY_CONNECTION_SETUP);

  const head = (
    <div class="pagehead">
      <h1>{t("setup.title")}</h1>
      <div class="muted">{t("setup.intro")}</div>
    </div>
  );
  if (!available)
    return (
      <div class="mon">
        <div class="setup">
          {head}
          <Unavailable t={t} />
        </div>
      </div>
    );
  if (probe.state !== "ready")
    return (
      <div class="mon">
        <div class="setup">
          {head}
          {probe.state === "unreadable" ? <Notice tone="bad">{t("setup.fileProblem", { message: probe.message })}</Notice> : <Notice>{t("setup.reading")}</Notice>}
        </div>
      </div>
    );

  if (save.kind === "saved") {
    return (
      <div class="mon">
        <div class="setup">
          <Section title={t("setup.saved.title")} sub={<Rich text={t("setup.saved.body", { name: save.connection, model: save.model })} />}>
            <p>
              <Rich text={save.usesStoredKey ? (save.keyPath ? t("setup.saved.keyAt", { path: save.keyPath }) : t("setup.saved.keyAtUnknown")) : service?.envName ? t("setup.saved.keyEnv", { name: service.envName }) : ""} />
            </p>
            <Notice tone={save.restart === "none" ? undefined : "wait"}>
              <Rich text={t(`setup.saved.restart.${save.restart}` as MessageKey)} />
            </Notice>
            <div class="setup-actions">
              <a class="btn primary" href={formatRoute({ view: "conversation" })}>
                {t("setup.done")}
              </a>
            </div>
          </Section>
        </div>
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();
  const matching = s.models.value.filter((m) => m.toLowerCase().includes(needle));
  const shown = matching.slice(0, MODELS_SHOWN);

  return (
    <div class="mon">
      <div class="setup">
        {head}
        <Section title={t("setup.step.service")}>
          <ChoiceList
            label={t("setup.svc.label")}
            value={service?.id}
            onChange={(id) => s.choose(id as (typeof SERVICES)[number]["id"])}
            choices={SERVICES.map((p) => ({ value: p.id, label: p.label[lang], note: t(`setup.svc.${p.id}` as MessageKey) }))}
          />
        </Section>

        {service ? (
          <Section title={service.needsKey ? t("setup.step.key") : t("setup.step.address")} sub={service.needsKey ? t("setup.apiKeyNote") : undefined}>
            {service.urlEditable ? (
              <>
                <Field ariaLabel={t("setup.url.label")} class="mono" placeholder="https://" autoComplete="off" spellcheck={false} value={s.baseUrl.value} onInput={(e) => s.setBaseUrl(e.currentTarget.value)} />
                <div class="muted caption">{t(service.id === "local" ? "setup.url.local" : service.id === "litellm" ? "setup.url.litellm" : "setup.url.other")}</div>
              </>
            ) : (
              <KeyValue rows={[{ key: t("setup.url.fixed"), value: service.baseUrl, mono: true }]} />
            )}
            {service.dialectEditable ? (
              <ButtonGroup label={t("setup.dialect.label")}>
                {DIALECTS.map((d) => (
                  <Button key={d} aria-pressed={s.api.value === d} onClick={() => s.setApi(d)}>
                    {t(`setup.dialect.${d}` as MessageKey)}
                  </Button>
                ))}
              </ButtonGroup>
            ) : null}
            {service.needsKey ? (
              <>
                {env.kind === "checking" ? <div class="muted">{t("setup.env.checking", { name: service.envName ?? "" })}</div> : null}
                {env.kind === "offered" ? (
                  <Notice
                    actions={
                      <>
                        <Button variant="primary" onClick={() => s.useEnv()}>{t("setup.env.use", { name: env.name })}</Button>
                        <Button onClick={() => s.declineEnv()}>{t("setup.env.other")}</Button>
                      </>
                    }
                  >
                    <Rich text={t("setup.env.found", { name: env.name })} />
                  </Notice>
                ) : null}
                {env.kind === "using" ? (
                  <Notice actions={<Button onClick={() => s.replaceKey()}>{t("setup.env.other")}</Button>}>
                    <Rich text={t("setup.env.using", { name: env.name })} />
                  </Notice>
                ) : null}
                {env.kind !== "offered" && env.kind !== "using" && env.kind !== "checking" ? (
                  s.keyHeld.value ? (
                    <Notice actions={<Button onClick={() => s.replaceKey()}>{t("setup.key.replace")}</Button>}>{t("setup.key.held")}</Notice>
                  ) : (
                    <>
                      <Field ariaLabel={t("setup.key.label")} placeholder={t("setup.key.label")} type="password" autoComplete="off" spellcheck={false} value={s.keyDraft.value} onInput={(e) => s.setKeyDraft(e.currentTarget.value)} />
                      {service.keyPageUrl ? <div class="setup-actions"><External href={service.keyPageUrl}>{t("setup.key.page")}</External></div> : null}
                    </>
                  )
                ) : null}
              </>
            ) : null}
          </Section>
        ) : null}

        {service ? (
          <Section
            title={t("setup.step.test")}
            sub={t("setup.test.sub")}
            actions={<Button variant="primary" disabled={!s.canTest.value} onClick={() => void s.runTest()}>{test.kind === "testing" ? t("setup.test.running") : t("setup.test.run")}</Button>}
          >
            <TestResult t={t} state={test} />
          </Section>
        ) : null}

        {service && test.kind === "ok" ? (
          <Section title={t("setup.step.model")} sub={t("setup.model.hint")}>
            {service.id === "local" ? (
              <Notice tone="wait" actions={<External href={OLLAMA_CONTEXT_URL}>{t("setup.model.localLink")}</External>}>
                {t("setup.model.localWarn")}
              </Notice>
            ) : null}
            {test.facts.models.length > MODELS_SHOWN ? <Field ariaLabel={t("setup.model.filter")} placeholder={t("setup.model.filter")} autoComplete="off" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} /> : null}
            {shown.length > 0 ? <ChoiceList label={t("setup.model.list")} mono value={s.model.value} onChange={(m) => s.setModel(m)} choices={shown.map((m) => ({ value: m, label: m }))} /> : <div class="muted">{t("setup.model.none")}</div>}
            {matching.length > shown.length ? <div class="muted caption">{t("setup.model.shown", { n: shown.length, total: matching.length })}</div> : null}
            <Field ariaLabel={t("setup.model.type")} class="mono" placeholder={t("setup.model.type")} autoComplete="off" spellcheck={false} value={s.model.value} onInput={(e) => s.setModel(e.currentTarget.value)} />
          </Section>
        ) : null}

        {service && test.kind === "ok" ? (
          <Section title={t("setup.step.save")} sub={<Rich text={t("setup.save.sub", { name: s.connectionName.value })} />}>
            {save.kind === "failed" ? (
              <Notice tone="bad">
                {t("setup.save.failed", { message: save.message })}
                {save.keyStored ? <div class="muted caption">{t("setup.save.keyStored")}</div> : null}
              </Notice>
            ) : null}
            <div class="setup-actions">
              <Button variant="primary" disabled={!s.canSave.value} onClick={() => void s.save()}>{save.kind === "saving" ? t("setup.save.saving") : t("setup.save.run")}</Button>
              {model.setup.needed.value ? <a class="btn link" href={formatRoute({ view: "conversation" })}>{t("setup.later")}</a> : null}
            </div>
          </Section>
        ) : null}
        {service && test.kind !== "ok" && model.setup.needed.value ? <div class="setup-actions"><a class="btn link" href={formatRoute({ view: "conversation" })}>{t("setup.later")}</a></div> : null}
      </div>
    </div>
  );
}
