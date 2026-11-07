import { useState } from "preact/hooks";
import { formatRoute, type DesignContext, type MessageKey } from "../../../ui-core/src";
import { Button, ChoiceList, Field, Notice, Section } from "../system/components";
import { Rich } from "./Rich";
import { TestResult } from "./SetupParts";

/** Longest model list drawn at once; the filter narrows the rest. */
const MODELS_SHOWN = 50;

/** The optional embeddings step. It sends no embeddings request: the model list is the only call to the service. */
export function SetupEmbedding({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const e = model.embedding;
  const [filter, setFilter] = useState("");
  const chosen = e.connection.value;
  const list = e.list.value;
  const save = e.saveState.value;
  const current = e.current.value;
  const unsupported = e.unsupported.value;
  const needle = filter.trim().toLowerCase();
  const matching = e.models.value.filter((m) => m.toLowerCase().includes(needle));
  const shown = matching.slice(0, MODELS_SHOWN);

  const restart = save.kind === "saved" ? (
    <Notice tone={save.restart === "none" ? undefined : "wait"}>
      <Rich text={t(`setup.saved.restart.${save.restart}` as MessageKey)} />
    </Notice>
  ) : null;

  const connectionNote = (name: string): string => {
    const api = e.apiOf(name);
    return api ? t("setup.embed.conn.note", { api }) : t("setup.embed.conn.noteUnknown");
  };

  return (
    <div class="mon">
      <div class="setup">
        <div class="pagehead">
          <h1>{t("setup.embed.title")}</h1>
          <div class="muted">{t("setup.embed.intro")}</div>
        </div>

        {save.kind === "saved" ? (
          <Section title={t("setup.saved.title")} sub={<Rich text={save.change === "on" ? t("setup.embed.savedOn", { connection: save.connection, model: save.model }) : t("setup.embed.savedOff")} />}>
            {restart}
            <div class="setup-actions">
              <a class="btn primary" href={formatRoute({ view: "conversation" })}>{t("setup.embed.done")}</a>
            </div>
          </Section>
        ) : (
          <>
            <Section title={t("setup.embed.step.conn")} sub={<Rich text={current ? t("setup.embed.current", current) : t("setup.embed.currentNone")} />}>
              {e.connections.value.length === 0 ? (
                <div class="muted">{t("setup.embed.conn.none")}</div>
              ) : (
                <ChoiceList
                  label={t("setup.embed.conn.label")}
                  mono
                  value={chosen}
                  onChange={(name) => {
                    setFilter("");
                    e.choose(name);
                  }}
                  choices={e.connections.value.map((name) => ({ value: name, label: name, note: connectionNote(name) }))}
                />
              )}
              {unsupported && chosen ? <Notice tone="bad"><Rich text={t("setup.embed.noApi", { name: chosen })} /></Notice> : null}
              <div class="setup-actions">
                <a class="btn" href={formatRoute({ view: "setup" })} onClick={() => e.startAdd()}>{t("setup.embed.add")}</a>
              </div>
            </Section>

            <Section title={t("setup.embed.step.model")} sub={t("setup.embed.model.hint")}>
              {chosen === undefined ? <div class="muted">{t("setup.embed.model.wait")}</div> : null}
              {chosen !== undefined && !unsupported ? (
                <>
                  <TestResult t={t} state={list} />
                  {e.models.value.length > 0 ? <Field ariaLabel={t("setup.model.filter")} placeholder={t("setup.model.filter")} autoComplete="off" value={filter} onInput={(ev) => setFilter(ev.currentTarget.value)} /> : null}
                  {shown.length > 0 ? <ChoiceList label={t("setup.model.list")} mono value={e.modelDraft.value} onChange={(m) => e.setModel(m)} choices={shown.map((m) => ({ value: m, label: m }))} /> : e.models.value.length > 0 ? <div class="muted">{t("setup.model.none")}</div> : null}
                  {matching.length > shown.length ? <div class="muted caption">{t("setup.model.shown", { n: shown.length, total: matching.length })}</div> : null}
                  <Field ariaLabel={t("setup.model.type")} class="mono" placeholder={t("setup.model.type")} autoComplete="off" spellcheck={false} value={e.modelDraft.value} onInput={(ev) => e.setModel(ev.currentTarget.value)} />
                </>
              ) : null}
            </Section>

            <Section title={t("setup.embed.step.on")}>
              <Notice tone="wait" title={t("setup.embed.warn.title")}>
                <ul class="setup-steps">
                  {(["setup.embed.warn.1", "setup.embed.warn.2", "setup.embed.warn.3"] as const).map((k) => <li key={k}>{t(k)}</li>)}
                </ul>
              </Notice>
              {save.kind === "failed" ? <Notice tone="bad">{t("setup.embed.failed", { message: save.message })}</Notice> : null}
              <div class="setup-actions">
                <Button variant="primary" disabled={!e.canSave.value} onClick={() => void e.save()}>{save.kind === "saving" ? t("setup.embed.saving") : t("setup.embed.on")}</Button>
                <a class="btn link" href={formatRoute({ view: "conversation" })}>{t("setup.embed.skip")}</a>
              </div>
            </Section>

            {current ? (
              <Section title={t("setup.embed.off")} sub={<Rich text={t("setup.embed.offNote")} />}>
                <div class="setup-actions">
                  <Button disabled={save.kind === "saving"} onClick={() => void e.turnOff()}>{t("setup.embed.off")}</Button>
                </div>
              </Section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
