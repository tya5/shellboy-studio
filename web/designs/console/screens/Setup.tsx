import { useState } from "preact/hooks";
import { CAPABILITY_CONNECTION_SETUP, DIALECTS, formatRoute, OLLAMA_CONTEXT_URL, SERVICES, type DesignContext, type MessageKey } from "../../../ui-core/src";
import { Button, ButtonGroup, Check, ChoiceList, Field, KeyValue, Notice, Section } from "../system/components";
import { Rich } from "./Rich";
import { SetupEmbedding } from "./SetupEmbedding";
import { External, TestResult, Unavailable } from "./SetupParts";

/** Longest model list drawn at once; the filter narrows the rest. */
const MODELS_SHOWN = 50;

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

  if (model.route.value.step === "embedding") return <SetupEmbedding context={context} />;

  if (save.kind === "saved") {
    const embed = model.embedding;
    return (
      <div class="mon">
        <div class="setup">
          <Section title={t("setup.saved.title")} sub={<Rich text={save.madeDefault ? t("setup.saved.body", { name: save.connection, model: save.model }) : t("setup.saved.bodyKept", { name: save.connection })} />}>
            {save.replaced ? <p><Rich text={t("setup.saved.replaced")} /></p> : null}
            <p>
              <Rich text={save.usesStoredKey ? (save.keyPath ? t("setup.saved.keyAt", { path: save.keyPath }) : t("setup.saved.keyAtUnknown")) : service?.envName ? t("setup.saved.keyEnv", { name: service.envName }) : ""} />
            </p>
            <Notice tone={save.restart === "none" ? undefined : "wait"}>
              <Rich text={t(`setup.saved.restart.${save.restart}` as MessageKey)} />
            </Notice>
            <div class="setup-actions">
              {embed.returning.value ? (
                <a class="btn primary" href={formatRoute({ view: "setup", step: "embedding" })} onClick={() => embed.comeBack(save.connection)}>
                  {t("setup.embed.back")}
                </a>
              ) : null}
              <a class={embed.returning.value ? "btn" : "btn primary"} href={formatRoute({ view: "conversation" })}>
                {t("setup.done")}
              </a>
            </div>
          </Section>
          {embed.returning.value ? null : (
            <Section title={t("setup.embed.offerTitle")} sub={t("setup.embed.offerBody")}>
              <div class="setup-actions">
                <a class="btn" href={formatRoute({ view: "setup", step: "embedding" })} onClick={() => embed.comeBack(save.connection)}>
                  {t("setup.embed.open")}
                </a>
                <a class="btn link" href={formatRoute({ view: "conversation" })}>
                  {t("setup.embed.skip")}
                </a>
              </div>
            </Section>
          )}
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
            {service.askUrl || s.editing.value ? (
              <>
                <Field ariaLabel={t("setup.url.label")} class="mono" placeholder="https://" autoComplete="off" spellcheck={false} value={s.baseUrl.value} onInput={(e) => s.setBaseUrl(e.currentTarget.value)} />
                <div class="muted caption">{t(service.id === "local" ? "setup.url.local" : service.id === "litellm" ? "setup.url.litellm" : "setup.url.other")}</div>
              </>
            ) : (
              <KeyValue rows={[{ key: t("setup.url.fixed"), value: service.baseUrl, mono: true }]} />
            )}
            {service.askDialect || s.editing.value ? (
              <ButtonGroup label={t("setup.dialect.label")}>
                {DIALECTS.map((d) => (
                  <Button key={d} aria-pressed={s.api.value === d} onClick={() => s.setApi(d)}>
                    {t(`setup.dialect.${d}` as MessageKey)}
                  </Button>
                ))}
              </ButtonGroup>
            ) : null}
            {!s.editing.value && !(service.askUrl && service.askDialect) ? (
              <div class="setup-actions">
                <Button onClick={() => s.editConnection()}>{t("setup.edit")}</Button>
              </div>
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
            {service.listSkipsKey && test.kind === "ok" ? <div class="muted caption">{t("setup.test.listSkipsKey")}</div> : null}
          </Section>
        ) : null}

        {service && test.kind === "ok" ? (
          <Section title={t(s.makeDefault.value ? "setup.step.model" : "setup.step.default")} sub={s.makeDefault.value ? t("setup.model.hint") : t("setup.default.off")}>
            {s.hasDefault.value ? <Check checked={s.makeDefault.value} onChange={(on) => s.setMakeDefault(on)} note={t("setup.default.have")}>{t("setup.default.label")}</Check> : null}
            {s.makeDefault.value ? <>
            {service.id === "local" ? (
              <Notice tone="wait" actions={<External href={OLLAMA_CONTEXT_URL}>{t("setup.model.localLink")}</External>}>
                {t("setup.model.localWarn")}
              </Notice>
            ) : null}
            {test.facts.models.length > MODELS_SHOWN ? <Field ariaLabel={t("setup.model.filter")} placeholder={t("setup.model.filter")} autoComplete="off" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} /> : null}
            {shown.length > 0 ? <ChoiceList label={t("setup.model.list")} mono value={s.model.value} onChange={(m) => s.setModel(m)} choices={shown.map((m) => ({ value: m, label: m }))} /> : <div class="muted">{t("setup.model.none")}</div>}
            {matching.length > shown.length ? <div class="muted caption">{t("setup.model.shown", { n: shown.length, total: matching.length })}</div> : null}
            <Field ariaLabel={t("setup.model.type")} class="mono" placeholder={t("setup.model.type")} autoComplete="off" spellcheck={false} value={s.model.value} onInput={(e) => s.setModel(e.currentTarget.value)} />
            </> : null}
          </Section>
        ) : null}

        {service && test.kind === "ok" ? (
          <Section title={t("setup.step.save")} sub={<Rich text={t(s.makeDefault.value ? "setup.save.sub" : "setup.save.subKeep", { name: s.connectionName.value })} />}>
            <Field ariaLabel={t("setup.name.label")} class="mono" placeholder={t("setup.name.label")} autoComplete="off" spellcheck={false} value={s.nameDraft.value ?? s.suggestedName.value} onInput={(e) => s.setName(e.currentTarget.value)} />
            <div class="muted caption"><Rich text={t("setup.name.hint")} /></div>
            {s.nameProblem.value ? <Notice tone="bad"><Rich text={t(`setup.name.${s.nameProblem.value}` as MessageKey)} /></Notice> : null}
            {s.replaces.value && !s.nameProblem.value ? (
              <Notice tone="wait">
                <Rich text={t("setup.name.replaces", { name: s.connectionName.value })} />
                <Check checked={s.confirmReplace.value} onChange={(on) => s.setConfirmReplace(on)}>{t("setup.name.confirm", { name: s.connectionName.value })}</Check>
              </Notice>
            ) : null}
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
