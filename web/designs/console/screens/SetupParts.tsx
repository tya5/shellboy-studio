import type { DesignContext, MessageKey, TestState } from "../../../ui-core/src";
import { Notice, Section } from "../system/components";
import { Rich } from "./Rich";

export type T = DesignContext["model"]["t"]["value"];

export function External({ href, children }: { href: string; children: string }) {
  return (
    <a class="btn link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export function Unavailable({ t }: { t: T }) {
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

export function TestResult({ t, state }: { t: T; state: TestState }) {
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

